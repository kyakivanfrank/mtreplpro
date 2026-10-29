'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ChartCoords } from '@/components/chart/chartCoords';
import type { QuoteState } from '@/lib/market/store';
import { positionNet, profitAtPrice } from '@/lib/trading/math';
import { PROFIT_DOWN, PROFIT_UP, profitColor } from '@/lib/trading/profit';
import { moneyWithCurrency } from '@/lib/money';
import type { PendingOrder, Position } from '@/lib/trading/types';

/* ------------------------------------------------------------------ */
/*  Open trades, drawn on the chart                                    */
/* ------------------------------------------------------------------ */
/**
 * Every open position and resting order as horizontal lines, the way the terminal draws them.
 *
 * This replaced a toast. A confirmation that says "#4 buy 0.01" and then disappears tells you
 * a trade happened; it does not tell you where it sits, how far the stop is, or whether the
 * target is anywhere near the last swing — which is the entire question a chart exists to
 * answer. Lines answer it permanently, and they are also the control surface: long-press a
 * stop or a target and it follows your finger until you let go.
 *
 * Entry lines are not draggable. An entry is a fact about a fill that already happened, and
 * the only honest way to change it is to close the position.
 *
 * A stop or a target is grabbed by simply dragging it: the moment the finger travels, the level
 * is under it and follows until release, and where it is let go is where the stop now is.
 *
 * It used to demand a 350ms long-press first. That existed to disambiguate from panning the
 * chart, which begins with an identical gesture — but the premise expired when stops stopped
 * being drawn permanently. They are now only on screen for a trade the user has deliberately
 * opened, so a finger that lands on one and pulls is not plausibly trying to pan; it is trying
 * to move the stop, and making it wait a third of a second for the privilege reads as the line
 * simply not being draggable. The press timer is kept only for the feedback it gives — hold
 * still on a level and it thickens to show it is grabbed, before any movement happens.
 *
 * ── One trade at a time ──────────────────────────────────────────────
 *
 * At rest the chart shows one line per position and nothing else: `BUY 0.01`. Tap it and that
 * trade opens up — its stop and target appear, and the entry starts quoting what it is worth.
 * Tap it again and all of it folds away.
 *
 * The reason is arithmetic. Three positions with stops and targets is nine horizontal lines
 * over the candles, and each entry permanently quoting a figure that moves on every tick is
 * three numbers animating on top of them. All of it is information the user asked for exactly
 * once, when they placed the trade; none of it is what they are looking at the chart to see.
 * Folded away, a position is one line saying where it sits. Opened, it is the full picture of
 * one trade. Both are readable, which the union of them is not.
 *
 * Within an opened trade the entry is still the master switch: tapping its stop moves the
 * figure to the stop, and tapping the entry again closes the whole thing.
 */

const PRESS_MS = 350;

/** How far a finger may wander before a press stops counting as one. */
const PRESS_SLOP_PX = 10;

/** Longest a tap may last and still be a tap rather than an abandoned press. */
const TAP_MS = 500;

/**
 * Entry lines borrow the app's profit palette rather than the chart convention.
 *
 * TradingView's teal/coral pair is the usual choice for candles, and it stays on the candles.
 * But a buy line drawn teal next to a header, a Trade tab and a P/L figure all speaking
 * blue-up / red-down makes the chart the one surface using a private vocabulary. A user
 * reading a teal line has to translate; a blue one they already know.
 *
 * Stops and targets keep their own colours — they are not directions, they are outcomes.
 */
const COLORS = {
  buy: PROFIT_UP,
  sell: PROFIT_DOWN,
  sl: '#FF453A',
  tp: '#30D158',
  pending: '#8e8e93',
};

/**
 * The dotted rule, used for entries only.
 *
 * Solid stops and targets against a dotted entry is what keeps them apart at a glance now that
 * a sell entry and a stop are both red: the texture carries the distinction the colour no
 * longer can.
 *
 * A repeating gradient rather than `border-top: dotted`, because the browser decides dot size
 * and spacing for a dotted border and gets it wrong at 1px — some render it as a near-solid
 * hairline at device-pixel-ratio 3, which is exactly the phone this is for.
 */
function dots(color: string): string {
  // Dashed, as the terminal draws an open position: 4 on, 3 off.
  return `repeating-linear-gradient(to right, ${color} 0 4px, transparent 4px 7px)`;
}

/** `+1.55 USD` / `-0.36 USD`: the terminal signs a position's running figure. */
function signedMoney(value: number): string {
  const text = moneyWithCurrency(value);
  return value > 0 ? `+${text}` : text;
}

type LevelKind = 'entry' | 'sl' | 'tp';

interface Level {
  kind: LevelKind;
  id: string;
  price: number;
  /** What the line always says: `BUY 0.01`, `SL`, `TP`. */
  label: string;
  color: string;
  draggable: boolean;
  /** The figure revealed on tap. Absent on pendings, which have no P/L until they fill. */
  amount?: number;
}

interface TradeLinesProps {
  symbol: string;
  positions: Position[];
  orders: PendingOrder[];
  /** Live quote for `symbol`, so an active entry line can price itself. */
  quote: QuoteState | undefined;
  /**
   * The whole board, read only for cross rates.
   *
   * A line's amount has to be the same number the Trade tab shows for the same position, and on
   * a cross that means converting the quote currency into dollars through its USD leg — which
   * is a different symbol than the one this chart is on. Passing the board is what lets the two
   * screens agree.
   */
  quotes: Record<string, QuoteState>;
  coords: ChartCoords;
  /** Width of the price column: lines stop at the plot's edge, the price box sits beyond it. */
  rightInset: number;
  digits: number;
  /** Bumped by the chart whenever it pans, zooms or receives new bars. */
  revision: number;
  /** Commit a dragged level. Returns an error to put the line back. */
  onMove: (id: string, changes: { sl?: number; tp?: number }) => { ok: true } | { ok: false; error: string };
  onReject: (message: string) => void;
}

export default function TradeLines({
  symbol,
  positions,
  orders,
  quote,
  quotes,
  coords,
  rightInset,
  digits,
  revision,
  onMove,
  onReject,
}: TradeLinesProps) {
  const layerRef = useRef<HTMLDivElement>(null);

  /** The level currently under the finger, and where it has been dragged to. */
  const [dragging, setDragging] = useState<{ level: Level; price: number } | null>(null);

  /**
   * The same thing, readable synchronously.
   *
   * The window listeners below arm the drag themselves, from inside a `pointermove`. State set
   * that way is not visible to the very next move event — those arrive faster than React
   * re-renders and re-subscribes — so a handler trusting `dragging` alone would spend the first
   * few events of every drag still believing no drag had started.
   */
  const draggingRef = useRef<{ level: Level; price: number } | null>(null);

  const setDrag = useCallback((next: { level: Level; price: number } | null) => {
    draggingRef.current = next;
    setDragging(next);
  }, []);

  /** Which single line is showing its money. One at a time — see the note above. */
  const [active, setActive] = useState<{ id: string; kind: LevelKind } | null>(null);

  const press = useRef<
    { level: Level; x: number; y: number; at: number; timer: ReturnType<typeof setTimeout> | null } | null
  >(null);

  const mine = positions.filter((p) => p.symbol === symbol);
  const resting = orders.filter((o) => o.symbol === symbol);

  const levels: Level[] = [];

  for (const position of mine) {
    const color = position.type === 'buy' ? COLORS.buy : COLORS.sell;
    const opened = active?.id === position.id;

    levels.push({
      kind: 'entry',
      id: position.id,
      price: position.openPrice,
      // Uppercase side and the volume it filled at — the two facts that identify the line.
      label: `${position.type.toUpperCase()} ${position.volume.toFixed(2)}`,
      color,
      draggable: false,
      amount: positionNet(position, quote, quotes) ?? undefined,
    });

    if (opened && position.sl != null) {
      levels.push({
        kind: 'sl',
        id: position.id,
        price: position.sl,
        label: 'SL',
        color: COLORS.sl,
        draggable: true,
        // What the stop costs if it is hit, rather than merely where it sits.
        amount: profitAtPrice(position, position.sl, quotes),
      });
    }

    if (opened && position.tp != null) {
      levels.push({
        kind: 'tp',
        id: position.id,
        price: position.tp,
        label: 'TP',
        color: COLORS.tp,
        draggable: true,
        amount: profitAtPrice(position, position.tp, quotes),
      });
    }
  }

  for (const order of resting) {
    levels.push({
      kind: 'entry',
      id: order.id,
      price: order.price,
      label: `${order.kind.toUpperCase()} ${order.volume.toFixed(2)}`,
      color: COLORS.pending,
      draggable: false,
    });
  }

  /* ---------- press, tap and drag ---------- */

  const cancelPress = useCallback(() => {
    if (press.current?.timer) clearTimeout(press.current.timer);
    press.current = null;
  }, []);

  const beginPress = (level: Level, event: React.PointerEvent) => {
    const entry = {
      level,
      x: event.clientX,
      y: event.clientY,
      at: Date.now(),
      timer: null as ReturnType<typeof setTimeout> | null,
    };

    // Only a stop or a target can be dragged; an entry can still be tapped for its figure.
    if (level.draggable) {
      entry.timer = setTimeout(() => {
        if (press.current) press.current.timer = null;
        setDrag({ level, price: level.price });
      }, PRESS_MS);
    }

    press.current = entry;
  };

  useEffect(() => {
    /** Where a pointer sits, in price. Null once it is outside the plotted range. */
    const priceUnder = (event: PointerEvent): number | null => {
      const layer = layerRef.current;
      if (!layer) return null;
      return coords.yToPrice(event.clientY - layer.getBoundingClientRect().top);
    };

    const toggleFigure = (level: Level) => {
      const { id, kind } = level;

      setActive((current) => {
        // The entry is the master switch: it opens the trade, and it closes it.
        if (kind === 'entry') return current?.id === id ? null : { id, kind: 'entry' };

        // A stop or target only hands the figure back to the entry. Collapsing to null here
        // would be a trap: it would take the very line being tapped off the chart, so the
        // gesture that dismissed the number would also delete its own target.
        return current?.id === id && current.kind === kind ? { id, kind: 'entry' } : { id, kind };
      });
    };

    const onMoveEvent = (event: PointerEvent) => {
      const drag = draggingRef.current;

      if (!drag) {
        const held = press.current;
        if (!held) return;

        const travelled = Math.abs(event.clientX - held.x) + Math.abs(event.clientY - held.y);
        if (travelled <= PRESS_SLOP_PX) return;

        // Travel on an entry means the finger was never taking a tap seriously.
        if (!held.level.draggable) {
          cancelPress();
          return;
        }

        // Travel on a stop or a target *is* the grab. Seeded from this same event rather than
        // from the level's own price, so the line arrives under the finger on the first frame
        // instead of jumping there on the second.
        if (held.timer) clearTimeout(held.timer);
        held.timer = null;
        event.preventDefault();
        setDrag({ level: held.level, price: priceUnder(event) ?? held.level.price });
        return;
      }

      event.preventDefault();
      const price = priceUnder(event);
      if (price !== null) setDrag({ ...drag, price });
    };

    const onUp = () => {
      const held = press.current;
      const drag = draggingRef.current;
      cancelPress();

      if (drag) {
        setDrag(null);

        // Grabbed but never actually moved — a press that changed nothing. Treated as the tap
        // it was meant to be rather than silently doing nothing, which is what it did while the
        // press timer could arm a drag out from under a user who only wanted the figure.
        if (Math.abs(drag.price - drag.level.price) < 10 ** -digits) {
          if (held && Date.now() - held.at < TAP_MS) toggleFigure(drag.level);
          return;
        }

        const result = onMove(drag.level.id, { [drag.level.kind]: drag.price } as {
          sl?: number;
          tp?: number;
        });
        if (!result.ok) onReject(result.error);
        return;
      }

      // Nothing moved and the drag never armed: a tap.
      if (held && Date.now() - held.at < TAP_MS) toggleFigure(held.level);
    };

    window.addEventListener('pointermove', onMoveEvent, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    return () => {
      window.removeEventListener('pointermove', onMoveEvent);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [coords, digits, onMove, onReject, cancelPress, setDrag]);

  // A line tapped on one instrument must not stay lit on the next one's chart.
  useEffect(() => {
    setActive(null);
  }, [symbol]);

  // `revision` is what re-runs this after a pan or zoom.
  void revision;

  if (levels.length === 0) return null;

  return (
    <div ref={layerRef} className="absolute inset-0 z-20 pointer-events-none">
      {levels.map((level) => {
        const held = dragging?.level.kind === level.kind && dragging.level.id === level.id;
        const price = held ? dragging.price : level.price;
        const y = coords.priceToY(price);
        if (y === null) return null;

        const lit = active?.id === level.id && active.kind === level.kind;
        const amount = level.amount;
        // An entry always quotes its running figure, as on the terminal; a stop or target only when
        // it has been tapped open.
        const showAmount = amount !== undefined && (level.kind === 'entry' || lit);

        return (
          <React.Fragment key={`${level.id}-${level.kind}`}>
            <div
              className="absolute left-0 pointer-events-none"
              style={{
                right: rightInset,
                top: y,
                height: held ? 2 : 1,
                ...(level.kind === 'entry'
                  ? { backgroundImage: dots(level.color) }
                  : { backgroundColor: level.color }),
                opacity: level.kind === 'entry' ? 0.9 : held ? 1 : 0.65,
              }}
            />

            {/*
              Sitting on the line, not in a chip on it. The old label was filled with the line's
              colour and set in black, which put a solid block over the candles at exactly the
              price the user cared about most — the one place on the chart worth not covering.
              Bare text clears it, and `-translate-y-full` lifts it clear of the rule so the two
              never overlap.
            */}
            <div
              className="absolute left-1 -translate-y-full pb-[2px] text-[11px] font-semibold pointer-events-none tabular-nums whitespace-nowrap"
              style={{ top: y, color: level.color }}
            >
              {level.label}
              {showAmount && (
                <>
                  {', '}
                  {/* Coloured by what it is worth rather than by which line it belongs to — the
                      same blue/white/red the trade header and the Trade tab use. */}
                  <span style={{ color: profitColor(amount) }}>{signedMoney(amount)}</span>
                </>
              )}
              {/* Only while it is being moved: setting a level is the one moment its price
                  matters more than its cost. */}
              {held && <span className="opacity-70"> {price.toFixed(digits)}</span>}
            </div>

            {/*
              The hit strip. Taller than the line so a finger can find it, and transparent so
              the chart is still readable through it. Now on every line rather than only the
              draggable ones — an entry has to be tappable to show its figure.
            */}
            <div
              onPointerDown={(event) => beginPress(level, event)}
              className="absolute left-0 -translate-y-1/2 h-8 pointer-events-auto"
              style={{ right: rightInset, top: y, touchAction: level.draggable ? 'none' : undefined }}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
}
