'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ViewLayout from '@/components/ui/ViewLayout';
import CenterDialog, { IN_EASE, IN_MS, OUT_EASE, OUT_MS } from '@/components/ui/CenterDialog';
import OrderTicketModal, { type LevelField } from '@/components/trade/OrderTicketModal';

import LevelPicker from '@/components/chart/LevelPicker';
import RevealFog from '@/components/chart/RevealFog';
import TradeLines from '@/components/chart/TradeLines';
import WindowPanel from '@/components/chart/WindowPanel';
import ChartCorner from '@/components/chart/parts/ChartCorner';
import ChartInfoOverlay from '@/components/chart/parts/ChartInfoOverlay';
import QuickTradeBar from '@/components/chart/parts/QuickTradeBar';
import {
  ChartBlocked,
  ChartToast,
  ChartWaiting,
  MarketClosedBadge,
} from '@/components/chart/parts/ChartStatus';
import {
  ChartActions,
  ChartTools,
  TimeframeButton,
  TimeframeStrip,
} from '@/components/chart/parts/ChartToolbar';
import { useCandleSeries } from '@/components/chart/useCandleSeries';
import { useChartInstance } from '@/components/chart/useChartInstance';
import {
  DEFAULT_CHART_SYMBOL,
  DEFAULT_TIMEFRAME,
  LEVEL_COLORS,
  LEVEL_LABELS,
  TIMEFRAMES,
  type ChartMode,
} from '@/components/chart/chartConfig';

import {
  marketStore,
  useBridgeMessage,
  usePlayback,
  useQuotes,
  useSeries,
  useSymbolState,
  useTradeable,
} from '@/lib/market/store';
import type { TimeframeKey } from '@/lib/market/types';
import { findInstrument } from '@/lib/instruments';
import { splitPrice } from '@/lib/forex';
import { STORAGE_KEYS, scopedKey, usePersistentState } from '@/lib/storage';
import { brokerSymbol, useAccount, useAccountScope } from '@/lib/account';
import { useBook, useTrading } from '@/lib/trading/store';
import { normalizeVolume } from '@/lib/trading/math';
import { useAutoTrader } from '@/lib/trading/autotrader';
import { planRewind } from '@/lib/trading/rewind';

export { DEFAULT_CHART_SYMBOL };

/**
 * The chart screen.
 *
 * Arrangement and state only. The lightweight-charts instance and its coordinate bridge live in
 * `./useChartInstance`, the bar-pushing in `./useCandleSeries`, every constant and options
 * object in `./chartConfig`, and each overlay, toolbar slot and drawer in `./parts`.
 */
export default function ChartView({ symbol = DEFAULT_CHART_SYMBOL }: { symbol?: string }) {
  // Timeframe is a user setting — the chart reopens on whatever they last used.
  const scope = useAccountScope();

  const [timeframeKey, setTimeframeKey] = usePersistentState<TimeframeKey>(
    scopedKey(STORAGE_KEYS.chartTimeframe, scope),
    DEFAULT_TIMEFRAME
  );
  const activeTimeframe =
    TIMEFRAMES.find((tf) => tf.value === timeframeKey) ??
    TIMEFRAMES.find((tf) => tf.value === DEFAULT_TIMEFRAME)!;

  /**
   * Which of the chart's three surfaces is out, if any. `'trade'` is the opening state, matching
   * MT5, where a chart arrives ready to trade from. Not persisted — a chart that opened without
   * its buy and sell prices because of something the user did yesterday would read as broken.
   */
  const [mode, setMode] = useState<ChartMode>('trade');

  const showTimeframes = mode === 'timeframes';
  const tradeBarOpen = mode === 'trade';
  const setupOpen = mode === 'setup';

  /** Out if it was not out, and nothing out if it was. The exclusivity is in the assignment. */
  const toggleMode = useCallback(
    (next: Exclude<ChartMode, null>) => setMode((current) => (current === next ? null : next)),
    []
  );

  // The lot the user last traded, so the terminal reopens on it.
  const [volume, setVolume] = usePersistentState<number>(scopedKey(STORAGE_KEYS.lot, scope), 0.01);

  /**
   * The stored lot, made legal for whatever the chart is now showing.
   *
   * One lot is remembered per account, not per symbol, so switching to an instrument whose
   * minimum is a whole lot would otherwise send 0.01 for the engine to refuse.
   */
  const tradeVolume = normalizeVolume(volume, symbol);

  /*
   * The automated trader, pointed at whatever this chart is showing — this is the one screen
   * where its work is visible as it happens. It does nothing until the setting is on.
   */
  const autoTrader = useAutoTrader(symbol);
  const [ticketOpen, setTicketOpen] = useState(false);

  /**
   * Aiming an order level at the chart. `picking` is the crosshair currently open; `picked` is
   * what it produced. The sequence number matters — setting the same price twice has to register
   * both times, and a bare {field, price} would look unchanged to React on the second.
   */
  const [picking, setPicking] = useState<{ field: LevelField; label: string; color: string; price: number } | null>(null);
  const [picked, setPicked] = useState<{ field: LevelField; price: number; seq: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  /** Bumped whenever the chart pans, zooms or takes new bars, to re-place the markers. */
  const [coordRevision, setCoordRevision] = useState(0);

  const playback = usePlayback();
  const symbolState = useSymbolState(symbol);
  /**
   * Whether this instrument's market is open at the session clock. Over a weekend the clock
   * follows bitcoin alone, so every pair beside it holds its Friday close and draws a flat run —
   * correct, and indistinguishable from a stalled feed without this.
   */
  const tradeable = useTradeable(symbol);
  const bridgeMessage = useBridgeMessage();
  const { quickTrade, modifyPosition } = useTrading();
  const book = useBook();

  /** The full extent of what this symbol has downloaded — the panel's ruler. Read every render. */
  const bounds = marketStore.archiveBounds(symbol);

  /**
   * The window as the finger currently has it, while the panel is open. Held here because two
   * things need it: how far ahead the series is drawn, and where the veil's edge sits.
   */
  const [preview, setPreview] = useState<{ start: number; end: number; now: number } | null>(null);

  /**
   * Where a drag currently has the playhead. Deliberately short-lived — left standing after
   * release it would pin the boundary to the moment the drag ended, so pressing play inside seek
   * mode would advance the clock under a line that never moved.
   */
  const [scrubMs, setScrubMs] = useState<number | null>(null);

  /**
   * Seek mode stops the tape; leaving it starts it again. Guarded on having actually been open,
   * because this must not touch the transport on mount: the session remembers whether it was
   * playing across launches, and a chart appearing on screen is not a decision to start it.
   */
  const seekWasOpen = React.useRef(false);

  useEffect(() => {
    if (setupOpen) {
      seekWasOpen.current = true;
      marketStore.pause();
      return;
    }

    if (!seekWasOpen.current) return;
    seekWasOpen.current = false;
    marketStore.play();
  }, [setupOpen]);

  useEffect(() => {
    if (!setupOpen) {
      setPreview(null);
      setScrubMs(null);
      marketStore.setPreview(0);
      return;
    }
    // Opening the panel exposes the rest of the window immediately — there is nothing to judge a
    // stop marker against otherwise.
    marketStore.setPreview(preview?.end ?? playback.endMs);
  }, [setupOpen, preview?.end, playback.endMs]);

  /**
   * Where the played tape ends, in unix seconds. Derived every render, never stored.
   *
   * There is no `playheadIndex` and there must not be: the session clock is one value shared by
   * every symbol and timeframe, because a gold position and a bitcoin position have to price at
   * the same moment. A per-chart index would be a second clock that can drift out of step with
   * the account. `Infinity` outside seek mode means nothing is ghosted at all.
   */
  const seekerMs = scrubMs ?? playback.clockMs;
  const ghostAfter = setupOpen ? Math.floor(seekerMs / 1000) : Number.POSITIVE_INFINITY;

  const instrument = findInstrument(symbol);
  const digits = instrument?.digits ?? 5;

  // Label only. `symbol` stays canonical ("XAUUSD") for every data call below.
  const account = useAccount();
  const displaySymbol = brokerSymbol(instrument?.display ?? symbol.replace('/', ''), account);

  /** Price precision follows the instrument — gold is 2dp, EURUSD is 5. */
  const fmt = (price: number): string => price.toFixed(digits);

  // Bars and prices both come from the shared tick stream — the chart never fetches.
  const symbols = useMemo(() => [symbol], [symbol]);
  const candles = useSeries(symbol, activeTimeframe.value);

  /** The candle the seeker is parked on — the last played one. */
  const seekerBar = useMemo(() => {
    if (!setupOpen) return null;

    for (let i = candles.length - 1; i >= 0; i -= 1) {
      if (candles[i].time <= ghostAfter) return candles[i];
    }
    return null;
  }, [setupOpen, candles, ghostAfter]);

  const quotes = useQuotes(symbols);

  const quote = quotes[symbol];
  const lastBid = quote?.bid ?? null;
  const lastAsk = quote?.ask ?? null;

  /** Only `no-store` — nothing held and nowhere to fetch it — is this chart's problem. */
  const empty = candles.length === 0;
  const waiting = empty && (symbolState === 'downloading' || symbolState === 'queued');
  const blocked = empty && !waiting;

  const { containerRef, chartRef, seriesRef, coords, corner, ohlc, setOhlc, panBars } =
    useChartInstance(digits, candles);

  useCandleSeries({
    chartRef,
    seriesRef,
    candles,
    timeframe: activeTimeframe.value,
    symbol,
    ghostAfter,
    onOhlc: setOhlc,
  });

  /* ---------- keep the dragged markers pinned while the chart moves ---------- */
  useEffect(() => {
    if (!setupOpen) return;

    const chart = chartRef.current;
    if (!chart) return;

    const bump = () => setCoordRevision((revision) => revision + 1);
    chart.timeScale().subscribeVisibleLogicalRangeChange(bump);
    bump(); // place them against the range as it stands right now

    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(bump);
  }, [setupOpen, candles.length, chartRef]);

  /* ---------- trading ---------- */
  const flash = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2000);
  }, []);

  const trade = (side: 'buy' | 'sell') => {
    // Nothing is said on success: the position draws itself on the chart, which answers "did that
    // work" better than a line of text that vanishes. The exact pair under the user's thumb goes
    // with it, so the fill is the price they read.
    const shown = lastBid !== null && lastAsk !== null ? { bid: lastBid, ask: lastAsk } : undefined;

    const result = quickTrade(symbol, side, tradeVolume, shown);
    if (!result.ok) flash(result.error);
  };

  /* ---------- the data window ---------- */
  /**
   * Committing a scrub. Backwards with an open book is the one case that asks first — a position
   * opened on Wednesday cannot be priced against a Tuesday clock. Forwards, or on an empty book,
   * there is nothing to lose and nothing to ask about.
   */
  const [pendingSeek, setPendingSeek] = useState<number | null>(null);

  /**
   * What a rewind to `ms` would cost, asked of the code that will perform it. Only losses count:
   * a position opened before the target survives and re-prices, and one open at the target is
   * handed back — prompting over those would train the user to dismiss the dialog unread.
   */
  const costOf = useCallback((ms: number) => planRewind(book, ms), [book]);

  const commitSeek = useCallback(
    (ms: number) => {
      // Held where it was dropped until the question is answered, so the dialog is about a moment
      // the user can still see the line sitting on.
      if (ms < playback.clockMs && costOf(ms).removed > 0) {
        setPendingSeek(ms);
        return;
      }

      marketStore.seekTo(ms);
      setScrubMs(null);
    },
    [playback.clockMs, costOf]
  );

  const pendingCost = pendingSeek === null ? null : costOf(pendingSeek);

  /** Same split the watchlist uses, so gold and crypto render their 2dp form correctly. */
  const formatBigPrice = (price: number | null) => {
    if (price === null) return { prefix: '—', big: '——', super: '—' };
    const { prefix, big, sup } = splitPrice(price, digits);
    return { prefix, big, super: sup };
  };

  return (
    <ViewLayout
      headerLeft={
        <TimeframeButton
          label={activeTimeframe.label}
          open={showTimeframes}
          onToggle={() => toggleMode('timeframes')}
        />
      }
      headerCenter={
        <ChartTools autoRunning={autoTrader.running} autoHolding={autoTrader.phase === 'holding'} />
      }
      headerRight={
        <ChartActions
          tradeBarOpen={tradeBarOpen}
          onNewOrder={() => setTicketOpen(true)}
          onToggleTradeBar={() => toggleMode('trade')}
        />
      }
      headerOverlay={
        showTimeframes ? (
          <TimeframeStrip
            active={activeTimeframe.value}
            onPick={(tf) => {
              setTimeframeKey(tf.value);
              setMode(null);
            }}
            onDismiss={() => setMode(null)}
          />
        ) : null
      }
      /*
        A pixel more air above and below the icons than the `py-2` everything else uses. The
        toolbar has no bar of its own — it floats on the chart — so its height is entirely its
        padding, and the row read tight against the trade drawer sliding out from under it.
      */
      headerClassName="py-[9px] px-4 bg-transparent"
      /*
        Cleared for the pill, not for the nav's whole footprint. `--nav-total-height` includes the
        20px of air above the pill, which is there so a scrolling list can fade out. The chart
        does not fade out; it ends in a hard axis, and reserving that gap left a visible band of
        dead black between the time labels and the pill.

        Plus 5px — about 5% of the nav block, and a quarter of the gap the other screens take.
        Enough that the time labels are not reading off the top edge of the pill, and not enough
        to reopen the dead band. The axis is also a drag target now that the nav lets touches
        past its padding, and a target flush against another control is one you catch the edge
        of; 5px is the difference between reaching for it and aiming at it.
      */
      wrapperClassName="pb-[calc(var(--nav-gap-bottom)+var(--nav-pill-height)+0px)]"
      contentClassName="flex flex-col relative bg-black min-h-0 overflow-hidden"
    >
      <QuickTradeBar
        open={tradeBarOpen}
        bid={formatBigPrice(lastBid)}
        ask={formatBigPrice(lastAsk)}
        hasBid={lastBid !== null}
        hasAsk={lastAsk !== null}
        symbol={symbol}
        volume={tradeVolume}
        onVolumeChange={setVolume}
        onTrade={trade}
      />

      {/* ===== Chart Area ===== */}
      <div className="flex-1 relative min-h-0 bg-black w-full">
        {/*
          The line the trade row leaves behind. With the row out, its own bottom border separates
          the toolbar from the chart; rolled up there is nothing there and the icons sit on the
          candles with no edge between them.

          Absolutely positioned rather than a `border-t`, because a border would add its pixel to
          the layout and shunt the whole chart down by one every time the row was hidden.
        */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-px z-10 pointer-events-none bg-white/15"
          style={{
            opacity: tradeBarOpen ? 0 : 1,
            transition: `opacity ${tradeBarOpen ? IN_MS : OUT_MS}ms ${tradeBarOpen ? IN_EASE : OUT_EASE}`,
          }}
        />

        <ChartInfoOverlay
          displaySymbol={displaySymbol}
          timeframeLabel={activeTimeframe.label}
          instrument={instrument}
          ohlc={ohlc}
          showOhlc={setupOpen}
          fmt={fmt}
        />

        {waiting && <ChartWaiting symbolState={symbolState} displaySymbol={displaySymbol} />}

        {blocked && (
          <ChartBlocked
            symbolState={symbolState}
            displaySymbol={displaySymbol}
            bridgeMessage={bridgeMessage}
          />
        )}

        {/*
          Only while the seek panel is out. A flat run of candles is unremarkable on an ordinary
          chart -- it is the *seeker* that raises the question, because dragging through a shut
          session shows a line that does not move and looks like a stalled feed. Outside that
          gesture the badge was answering a question nobody had asked, and sat over the candles
          on every weekend.
        */}
        {setupOpen && !empty && !tradeable && <MarketClosedBadge />}

        <div ref={containerRef} className="absolute inset-0" />

        {/* Open trades, as lines. Long-press a stop or target to move it. */}
        <TradeLines
          symbol={symbol}
          positions={book.positions}
          orders={book.orders}
          quote={quote}
          quotes={quotes}
          coords={coords}
          digits={digits}
          revision={coordRevision}
          onMove={modifyPosition}
          onReject={flash}
        />

        {/* Everything past the seeker, veiled — only while the window is being set */}
        {setupOpen && playback.ready && (
          <RevealFog
            coords={coords}
            atMs={seekerMs}
            minMs={playback.startMs}
            maxMs={playback.endMs}
            bar={seekerBar}
            digits={digits}
            revision={coordRevision}
            // Moves the boundary and nothing else; the clock is left alone until release. The
            // value is a snapped bar time, so a drag within one candle costs no render.
            onScrub={setScrubMs}
            onCommit={commitSeek}
            onPan={panBars}
          />
        )}

        {/*
          The one thing a scrub asks before doing. Only ever raised for a backwards seek with
          positions open; Cancel puts the line back where the clock actually is.
        */}
        <CenterDialog
          open={pendingSeek !== null}
          onClose={() => {
            setPendingSeek(null);
            setScrubMs(null);
          }}
          align="center"
          title={
            pendingCost?.removed === 1
              ? 'Moving back removes 1 trade'
              : `Moving back removes ${pendingCost?.removed ?? 0} trades`
          }
          description={
            pendingCost && pendingCost.legacy > 0
              ? `${pendingCost.legacy} older ${pendingCost.legacy === 1 ? 'trade' : 'trades'} will be removed rather than reopened.`
              : undefined
          }
          actions={[
            {
              label: 'Continue',
              onClick: () => {
                if (pendingSeek !== null) marketStore.seekTo(pendingSeek);
                setPendingSeek(null);
                setScrubMs(null);
              },
              closes: true,
            },
          ]}
        />

        {/* The window panel — held open from the ••• */}
        {setupOpen && playback.ready && bounds && (
          <WindowPanel
            fromMs={bounds.fromMs}
            toMs={bounds.toMs}
            startMs={playback.startMs}
            clockMs={playback.clockMs}
            playing={playback.playing}
            onSetStart={(ms) => marketStore.setWindowStart(ms)}
            onSeek={commitSeek}
            onPreview={(draft) => {
              setPreview(draft);
              setScrubMs(draft.now);
            }}
            onTogglePlay={() => {
              // Pressing play closes the panel: the veil is a tool for *choosing* a window, and
              // once the session is running the chart should be forming candles normally.
              const starting = !playback.playing;
              marketStore.togglePlay();
              if (starting) setMode(null);
            }}
            onClose={() => setMode(null)}
            speed={playback.speed}
            onSetSpeed={(speed) => marketStore.setSpeed(speed)}
          />
        )}

        {/* Aiming one order level at the candles */}
        {picking && (
          <LevelPicker
            field={picking.field}
            label={picking.label}
            color={picking.color}
            initialPrice={picking.price}
            candles={candles}
            coords={coords}
            digits={digits}
            revision={coordRevision}
            onSet={(field, price) => {
              setPicked((previous) => ({ field, price, seq: (previous?.seq ?? 0) + 1 }));
              setPicking(null);
            }}
            onCancel={() => setPicking(null)}
          />
        )}

        {toast && <ChartToast message={toast} />}
      </div>

      <ChartCorner corner={corner} active={setupOpen} onHold={() => toggleMode('setup')} />

      <OrderTicketModal
        // Hidden, not closed, while a level is being aimed: the ticket keeps its state and the
        // user comes back to the order they were half-way through writing.
        open={ticketOpen && !picking}
        symbol={symbol}
        onClose={() => setTicketOpen(false)}
        picked={picked}
        onPickLevel={(field, current) =>
          setPicking({
            field,
            label: LEVEL_LABELS[field],
            color: LEVEL_COLORS[field],
            price: current ?? lastBid ?? 0,
          })
        }
      />
    </ViewLayout>
  );
}
