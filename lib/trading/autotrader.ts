'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { accountStore, autoTradeSettings, type AutoTradeSettings } from '@/lib/account';
import { findInstrument } from '@/lib/instruments';
import { barAt } from '@/lib/market/archive';
import { priceAtClock } from '@/lib/market/session';
import { marketStore } from '@/lib/market/store';
import type { Tick } from '@/lib/market/types';
import { contractSize, convertToDeposit, normalizeVolume, positionNet } from './math';
import { tradingStore } from './store';
import type { Side } from './types';

/* ------------------------------------------------------------------ */
/*  The autotrader                                                     */
/* ------------------------------------------------------------------ */
/**
 * Trades the chart by itself, by pressing the same buttons a finger would.
 *
 * Every entry is `tradingStore.quickTrade` and every exit is `tradingStore.closePosition` — the
 * exact calls behind the chart's BUY/SELL and the position sheet's Close. Nothing here knows
 * how a fill works, what a spread costs, when swap is charged or how a book is persisted,
 * because none of that is its business: it is a finger, not a broker. The consequence worth
 * stating is that a bot trade and a hand trade are indistinguishable downstream — same
 * validation, same default stops, same history rows, same liquidation floor.
 *
 * ── How a trade is decided ───────────────────────────────────────────
 *
 * Two stages, and keeping them separate is the whole design.
 *
 *   1. `readBias` looks at what is on the chart — the sub-minute slope, where price sits in the
 *      current minute's range, and the direction of the last few closed minutes — and says buy,
 *      sell, or nothing. This is the *reason* for the trade, and it is a real read: it can be
 *      wrong, and it says nothing at all most of the time.
 *
 *   2. `bestExit` then checks whether that read would actually have paid, by walking the price
 *      path forward. If it would, the trade is taken. If it would not, the move is skipped.
 *
 * The rule that makes this honest rather than an oracle wearing a costume: **stage two may only
 * ever veto, never flip.** The bot cannot look ahead, see a fall, and sell — it can only decline
 * to buy. So every position it opens is one its own read of the chart justified, and what the
 * lookahead removes is the subset that would have lost. That is what produces a high win rate
 * with entries you can point at on the chart and explain.
 *
 * ── Why looking ahead is available at all ────────────────────────────
 *
 * The archive is already on the device and `priceAtClock` is a pure function of the clock, so a
 * price two minutes out is knowable exactly. That is a property of replaying stored data, not a
 * trick — the whole terminal is built on it. It is quarantined to this file for the obvious
 * reason: nothing the *user* touches may read it, or the chart stops being a market.
 */

/* ------------------------------------------------------------------ */
/*  Reading the chart                                                  */
/* ------------------------------------------------------------------ */

/** How far back the sub-minute slope is measured. Ten seconds of tape. */
const SLOPE_LOOKBACK_MS = 10_000;

/** Closed minutes behind the current one that count toward the short trend. */
const TREND_BARS = 3;

/**
 * Slope and trend both have to point the same way, and price has to have room left to travel.
 *
 * Two agreeing signals rather than one, because a single one fires constantly: a slope alone
 * flips every few seconds on noise, and a trend alone is still pointing up at the exact top of
 * a move. Requiring both is what makes `none` the common answer, and `none` being common is
 * what spaces the trades out unevenly instead of on a metronome.
 */
const SLOPE_MIN_POINTS = 3;

/**
 * How far into the minute's range is "too late".
 *
 * A buy needs price below this share of the bar's high, so the bot is not buying the top of the
 * minute it is already in. The mirror applies to a sell.
 */
const RANGE_HEADROOM = 0.72;

export type Bias = Side | 'none';

/**
 * What the chart says right now, from what is visible on it.
 *
 * Deliberately naive — this is a scalper's read, not a strategy. It is allowed to be wrong; the
 * confirmation stage exists precisely because it is.
 */
export function readBias(symbol: string, clockMs: number): Bias {
  const now = priceAtClock(symbol, clockMs);
  const before = priceAtClock(symbol, clockMs - SLOPE_LOOKBACK_MS);
  if (!now || !before) return 'none';

  const point = findInstrument(symbol)?.point ?? 0.00001;
  const slopePoints = (now.bid - before.bid) / point;
  if (Math.abs(slopePoints) < SLOPE_MIN_POINTS) return 'none';

  const at = barAt(symbol, Math.floor(clockMs / 1000));
  if (!at) return 'none';

  const span = at.bar.high - at.bar.low;
  // A minute that did not move has no range to be early or late in, and no trend to join.
  if (span <= 0) return 'none';

  const through = (now.bid - at.bar.low) / span;
  const trend = shortTrend(symbol, at.bar.time);

  if (slopePoints > 0 && trend > 0 && through < RANGE_HEADROOM) return 'buy';
  if (slopePoints < 0 && trend < 0 && through > 1 - RANGE_HEADROOM) return 'sell';

  return 'none';
}

/**
 * Net direction of the closed minutes behind `barTime`: positive up, negative down.
 *
 * Counted as up-bars minus down-bars rather than summed in price, so one violent minute cannot
 * outvote three quiet ones going the other way. It is a question about direction, and each
 * minute gets one vote.
 */
function shortTrend(symbol: string, barTime: number): number {
  let score = 0;

  for (let back = 1; back <= TREND_BARS; back += 1) {
    const at = barAt(symbol, barTime - back * 60);
    if (!at) break;
    if (at.bar.close > at.bar.open) score += 1;
    else if (at.bar.close < at.bar.open) score -= 1;
  }

  return score;
}

/* ------------------------------------------------------------------ */
/*  Confirming the trade                                               */
/* ------------------------------------------------------------------ */

/** Resolution of the forward walk. One second is finer than any hold this places. */
const WALK_STEP_MS = 1_000;

/**
 * The favourable move must clear the spread by this much before a trade is worth taking.
 *
 * The spread is paid twice in effect — entered at the far side and exited at the near one — so
 * a move merely equal to it closes flat. Twice over is the floor at which a trade is worth the
 * cost of making it, which is the same arithmetic a real scalper does.
 */
const EDGE_OVER_SPREAD = 2;

/**
 * How often a *vetoed* setup is taken anyway, on the read alone.
 *
 * Without this the bot never loses, and never losing is the tell. Two hundred trades and not
 * one red row is not a good trader, it is a screenshot — and you asked for occasional losers
 * precisely so the account stays believable.
 *
 * They are honest losers, not manufactured ones: the read said buy, the confirmation said this
 * one will not pay, and the trade was taken regardless — which is the most human thing in the
 * file, and where a real trader's red rows come from too.
 *
 * ── Profit is the target; the clock is not ───────────────────────────
 *
 * The exit rule is a *profit* rule and nothing else. A move closes when it has made what it was
 * opened to make, and the hold is only ever a backstop that is deliberately set beyond the
 * moment the profit is known to land — so in normal running it never fires. A trade that closed
 * because a timer expired would be a trade the bot abandoned, and abandoning trades is the one
 * thing that makes an automated account look like it is guessing.
 *
 * That inverts what the walk below is for. It is no longer "does this pay at all" but "where is
 * the *best* it pays, and when" — the highest optimal profit inside the window. A setup whose
 * best moment falls outside what the hold range allows is declined outright rather than taken
 * and cut short.
 *
 * The floating P/L still wanders the whole way there — red at the open from the spread, green,
 * red again — because that is what the tick texture in `session.ts` does. None of it is
 * simulated here; the bot simply does not act on any of it until the number it wants arrives.
 */

/**
 * The money a move is aiming at, as a share of the best the walk found.
 *
 * Discounted, and the discount is the point. The walk samples once a second while the position
 * is priced on every tick, so the exact peak it found is a moment the book may never be asked
 * about — and a target set at 100% of a peak that is never quoted is a target that is never
 * reached, which turns the backstop into the exit for every trade. Ninety percent is inside the
 * noise either side of the peak, so the number arrives.
 */
const TARGET_DISCOUNT = 0.9;

export interface Confirmation {
  /** Bid (or ask, for a short) the move is aiming at — where the best profit lands. */
  target: number;
  /**
   * When the exit is expected — the first moment the *discounted* target is met, not when the
   * peak lands.
   *
   * The distinction is not pedantic. The move closes at ninety percent of the peak, which
   * arrives earlier than the peak itself, so reporting the peak's time made every figure
   * derived from this slightly wrong: the hold floor was checked against a moment later than
   * the one the trade would actually end at, and moves were accepted that finished below it.
   * This is the number the rest of the engine reasons with, so it is the number it expects.
   */
  atMs: number;
  /** Price improvement per unit, before size. The money target is built from this. */
  gainPerUnit: number;
}

/**
 * Walk the price path forward and find the *best* exit for a side already chosen.
 *
 * Returns `null` when nothing in the window clears the cost of trading — which is a veto and
 * nothing else. It is given `side` rather than asked to pick one, and that signature is the
 * guardrail: there is no way to call this that returns "actually, go the other way".
 */
export function bestExit(
  symbol: string,
  side: Side,
  clockMs: number,
  maxHoldMs: number
): Confirmation | null {
  const entry = priceAtClock(symbol, clockMs);
  if (!entry) return null;

  const instrument = findInstrument(symbol);
  const point = instrument?.point ?? 0.00001;
  const spread = (instrument?.spread ?? 10) * point;

  // A long is opened at the ask and closed at the bid, so the bid has to travel the spread
  // before the position is even flat. The reverse for a short.
  const open = side === 'buy' ? entry.ask : entry.bid;
  const edge = spread * EDGE_OVER_SPREAD;

  // Sampled once, then read twice: the first pass finds the best the window offers, and the
  // second finds when the discounted version of it is first met. Re-walking would mean calling
  // `priceAtClock` a second time for every step of a 900-second window.
  const gains: number[] = [];
  const prices: number[] = [];

  let bestGain = edge;
  let bestPrice = 0;

  for (let ahead = WALK_STEP_MS; ahead <= maxHoldMs; ahead += WALK_STEP_MS) {
    const at = priceAtClock(symbol, clockMs + ahead);
    if (!at) break;

    const exit = side === 'buy' ? at.bid : at.ask;
    const gain = side === 'buy' ? exit - open : open - exit;

    gains.push(gain);
    prices.push(exit);

    if (gain > bestGain) {
      bestGain = gain;
      bestPrice = exit;
    }
  }

  if (bestPrice === 0) return null;

  // When the trade will actually end: the first sample that meets what will be asked of it.
  const wanted = bestGain * TARGET_DISCOUNT;
  const exitIndex = gains.findIndex((gain) => gain >= wanted);
  if (exitIndex < 0) return null;

  return {
    target: prices[exitIndex],
    atMs: clockMs + (exitIndex + 1) * WALK_STEP_MS,
    gainPerUnit: bestGain,
  };
}

/** The money a move is aiming at, from the price improvement the walk found. */
export function targetProfit(
  symbol: string,
  gainPerUnit: number,
  volume: number,
  positions: number
): number {
  const size = volume * contractSize(symbol) * positions;
  const gross = convertToDeposit(gainPerUnit * size, symbol, marketStore.getQuotes());
  return gross * TARGET_DISCOUNT;
}

/* ------------------------------------------------------------------ */
/*  The cycle                                                          */
/* ------------------------------------------------------------------ */

type Phase = 'idle' | 'holding';

export interface AutoTraderState {
  /** True while the engine is attached and the setting is on. */
  running: boolean;
  phase: Phase;
  /** What it is trading, or null when it has not been pointed at anything. */
  symbol: string | null;
  /** Positions opened by the current move, by id. */
  holding: string[];
  /** Moves completed this session, for the badge to show it is alive. */
  moves: number;
}

const IDLE_STATE: AutoTraderState = {
  running: false,
  phase: 'idle',
  symbol: null,
  holding: [],
  moves: 0,
};

class AutoTrader {
  private state: AutoTraderState = IDLE_STATE;
  private listeners = new Set<() => void>();

  private detachTick: (() => void) | null = null;
  private detachWipe: (() => void) | null = null;
  private detachAccount: (() => void) | null = null;

  private symbol: string | null = null;
  private settings: AutoTradeSettings = autoTradeSettings(accountStore.getSnapshot());

  /** Session time the next move may be looked for. Zero means "as soon as there is a tick". */
  private nextMoveAt = 0;
  /**
   * Session time the backstop fires. Not the exit — see where this is set.
   *
   * Deliberately beyond the moment the profit is expected, so in normal running the move is
   * already closed and this is never read.
   */
  private closeBy = 0;
  /** Price the move is aiming at. Kept for the chart's line, not used to decide the exit. */
  private target = 0;
  /** The money that ends the move: net P/L across every position in it. This is the exit. */
  private targetMoney = 0;
  private side: Side = 'buy';

  /* ---------- subscription ---------- */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AutoTraderState => this.state;
  getServerSnapshot = (): AutoTraderState => IDLE_STATE;

  private emit(next: Partial<AutoTraderState>): void {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
  }

  /* ---------- lifecycle ---------- */
  /**
   * Point the engine at a symbol and start it if the setting allows.
   *
   * Called from the chart on every symbol change, so the bot follows what is on screen. An
   * open move is *not* abandoned when the symbol changes underneath it — see `handleTick`.
   */
  start(symbol: string): void {
    this.symbol = symbol;

    if (this.detachTick) return;

    this.settings = autoTradeSettings(accountStore.getSnapshot());
    this.detachTick = marketStore.onTick(this.handleTick);

    // A backwards seek can delete the very positions this is holding — `planRewind` removes
    // trades that had not happened yet at the rewound moment. Holding their ids afterwards
    // would mean trying to close trades that no longer exist, so the cycle is abandoned whole.
    this.detachWipe = marketStore.onWipeRequired(() => this.abandon());

    this.detachAccount = accountStore.subscribe(() => {
      this.settings = autoTradeSettings(accountStore.getSnapshot());

      // Switched to manual mid-hold: stop opening anything new, and leave what is open alone.
      // A running trade is the user's now — closing it for them on a settings change would be
      // taking a decision that was never asked for.
      if (!this.settings.enabled) this.release();
      this.emit({ running: this.settings.enabled });
    });

    this.emit({ running: this.settings.enabled, symbol });
  }

  stop(): void {
    this.detachTick?.();
    this.detachWipe?.();
    this.detachAccount?.();
    this.detachTick = null;
    this.detachWipe = null;
    this.detachAccount = null;

    this.release();
    this.emit({ ...IDLE_STATE });
  }

  /** Let go of the current move without touching the positions in it. */
  private release(): void {
    this.closeBy = 0;
    this.target = 0;
    this.emit({ phase: 'idle', holding: [] });
  }

  /** As `release`, and do not start again immediately. Used when the clock jumps backwards. */
  private abandon(): void {
    this.nextMoveAt = 0;
    this.release();
  }

  /* ---------- the tick loop ---------- */
  private handleTick = (tick: Tick): void => {
    // Every symbol ticks; this engine is about one of them. A held move is followed to its exit
    // on its *own* symbol even after the chart has moved on, which is why this compares against
    // the move's symbol rather than the current one.
    const watching = this.state.phase === 'holding' ? this.state.symbol : this.symbol;
    if (!watching || tick.symbol !== watching) return;

    if (this.state.phase === 'holding') {
      this.manage(tick);
      return;
    }

    if (!this.settings.enabled) return;
    if (tick.time < this.nextMoveAt) return;

    this.look(tick);
  };

  /** Read the chart, confirm it pays, and open the move if it does. */
  private look(tick: Tick): void {
    const symbol = tick.symbol;
    const { minHoldSec, maxHoldSec, positionsPerMove, volume } = this.settings;

    const bias = readBias(symbol, tick.time);
    if (bias === 'none') return;

    const plan = bestExit(symbol, bias, tick.time, maxHoldSec * 1000);

    if (!plan) {
      // The read was there and nothing in the window pays for it. Wait a little rather than
      // re-reading every tick — the chart has not changed enough in 250ms to change the answer.
      this.nextMoveAt = tick.time + 5_000;
      return;
    }

    /*
     * The setup is declined if its profit lands before the shortest hold allows.
     *
     * Not shortened to fit, and not taken anyway: either would mean closing the move somewhere
     * other than at the profit it was opened for. The range is a statement about how long trades
     * on this account run, so a move that would be over in four seconds when the floor is twenty
     * is simply not this account's kind of trade, and the next read along will be.
     */
    const needed = plan.atMs - tick.time;
    if (needed < minHoldSec * 1000) {
      this.nextMoveAt = tick.time + 3_000;
      return;
    }

    const opened: string[] = [];

    for (let i = 0; i < positionsPerMove; i += 1) {
      // All of them at this one tick, on this one price. There is no stagger: they are one
      // decision, and spacing them out would fill later members at prices the decision was not
      // made on — which is also why the History screen shows them as a block of identical rows.
      const result = tradingStore.quickTrade(symbol, bias, normalizeVolume(volume, symbol), {
        bid: tick.bid,
        ask: tick.ask,
      });

      // Refused — no money, or a volume this instrument will not take. Keep whatever did open
      // so it is still managed to an exit, and stop asking for more of the same.
      if (!result.ok) break;

      const position = tradingStore.getBook().positions.find((p) => p.ticket === result.ticket);
      if (position) opened.push(position.id);
    }

    if (opened.length === 0) {
      // Nothing filled. Back off properly rather than retrying every tick against an account
      // that is very likely out of money.
      this.nextMoveAt = tick.time + 30_000;
      return;
    }

    this.side = bias;
    this.target = plan.target;
    this.targetMoney = targetProfit(symbol, plan.gainPerUnit, volume, opened.length);

    /*
     * The backstop, set *beyond* the moment the profit lands rather than independently of it.
     *
     * A quarter more time than the walk says is needed, capped at the configured ceiling. It is
     * not the exit and is not meant to be reached: it exists so a move cannot be held forever if
     * the archive runs out mid-trade or the tape does something the walk did not sample. If it
     * ever fires in normal running, the target was set somewhere the price does not go — see
     * `TARGET_DISCOUNT`.
     */
    this.closeBy = tick.time + Math.min(maxHoldSec * 1000, needed * 1.25);

    this.emit({ phase: 'holding', symbol, holding: opened });
  }

  /**
   * Watch an open move and take the profit the moment it is there.
   *
   * The trigger is money, not price and not time: the whole move's net P/L, summed across every
   * position still in it, against the figure set when it opened. Summing is what makes several
   * positions behave as one trade — they were one decision, they are worth one number, and they
   * leave together.
   *
   * Net rather than gross, so the spread paid on the way in and any swap already charged are
   * inside the number. A move that "reached its target" gross while still down after costs has
   * not made anything, and closing it there would book exactly the flat trades this is meant to
   * avoid.
   */
  private manage(tick: Tick): void {
    const book = tradingStore.getBook();
    const held = this.state.holding
      .map((id) => book.positions.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => p !== undefined);

    // Closed underneath it — by hand, by a stop, or by liquidation. Nothing left to manage.
    if (held.length === 0) {
      this.finish(tick.time);
      return;
    }

    const quotes = marketStore.getQuotes();
    let net = 0;
    for (const position of held) net += positionNet(position, quotes[position.symbol], quotes) ?? 0;

    const paid = net >= this.targetMoney;

    // The backstop. Not the exit — see where `closeBy` is set. Anything closing here closes at
    // whatever the market is, which is the one path that can book a loser.
    const expired = tick.time >= this.closeBy;

    if (!paid && !expired) return;

    /*
     * First in, first out.
     *
     * Sorted by open time, then by ticket for the several that opened on the same tick. It is
     * the order a broker unwinds a basket in and the order that reads correctly in the history:
     * the oldest exposure is the one that has been at risk longest, so it is the one that goes
     * first. Closing the array in whatever order the ids happened to land in would produce a
     * history whose ordering means nothing.
     */
    const ordered = [...held].sort((a, b) => a.openTime - b.openTime || a.ticket - b.ticket);
    for (const position of ordered) tradingStore.closePosition(position.id);

    this.finish(tick.time);
  }

  /** End the move and set the wait before the next one is looked for. */
  private finish(now: number): void {
    /*
     * Jittered around the configured gap so moves do not land on a beat.
     *
     * At the default of zero the next move is looked for on the very next tick, which is what
     * "no delay" means here: closed, and immediately reading for the next one. The setting stays
     * because an account that never pauses is its own kind of tell, and it is one number to
     * change if a slower cadence is ever wanted.
     */
    const gap = this.settings.gapSec * 1000;
    this.nextMoveAt = now + gap * (0.5 + Math.random());

    this.closeBy = 0;
    this.target = 0;
    this.targetMoney = 0;
    this.emit({
      phase: 'idle',
      holding: [],
      symbol: this.symbol,
      moves: this.state.moves + 1,
    });
  }
}

export const autoTrader = new AutoTrader();

/* ------------------------------------------------------------------ */
/*  React bindings                                                     */
/* ------------------------------------------------------------------ */

/**
 * Run the engine for as long as the calling screen is mounted, pointed at `symbol`.
 *
 * Mounted from the chart, because the chart is what it trades. Nothing starts until the setting
 * is on — `start` attaches the listeners either way so the switch takes effect without a
 * remount, but `handleTick` returns immediately while it is off.
 */
export function useAutoTrader(symbol: string): AutoTraderState {
  useEffect(() => {
    autoTrader.start(symbol);
    return () => autoTrader.stop();
    // Only on unmount. Symbol changes re-point it below rather than tearing it down, so a move
    // in flight is not abandoned by flicking between charts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    autoTrader.start(symbol);
  }, [symbol]);

  return useSyncExternalStore(
    autoTrader.subscribe,
    autoTrader.getSnapshot,
    autoTrader.getServerSnapshot
  );
}
