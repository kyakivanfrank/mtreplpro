'use client';

import { findInstrument } from '@/lib/instruments';
import { readSetting, writeSetting } from '@/lib/storage';
import { archiveRange, barAt, nextBarTime } from './archive';
import type { Candle, Tick, TickHandler } from './types';

/* ------------------------------------------------------------------ */
/*  The playback session                                               */
/* ------------------------------------------------------------------ */
/**
 * One clock for the whole terminal.
 *
 * Every chart, every quote row, every fill and every pending order reads this clock. It is not
 * per-chart on purpose: a session where gold is at Tuesday noon while bitcoin is at Wednesday
 * would let a user "predict" one instrument from another and would price two legs of the same
 * account at two different moments. One clock means the app behaves like a market.
 *
 * It advances at a fixed multiple of wall-clock rate — see `PLAYBACK_SPEED`. What is different
 * from live is only *when* and *how fast*: the window sits a few hours behind the present, over
 * data the device already holds, so nothing is ever re-synced underneath a chart that is being
 * read or traded.
 *
 * The window has one margin the user sets and one they cannot:
 *
 *   start — how far back into the archive to begin. Setting it re-seats the clock there.
 *   end   — always the newest bar the device holds. There is nothing to configure: stopping
 *           early is what pausing is for, and an end that could be pinned behind the data was a
 *           second way to say the same thing plus a way to strand the session short of it. It
 *           follows every download, so a run left playing simply keeps going.
 *
 * Prices inside a minute are synthesized from that minute's OHLC, along the path MT5's own
 * tester models: open to low to high to close on an up bar, open to high to low to close on a
 * down one, with tick texture laid over it so the quote trades instead of counting. It is a
 * pure function of the clock — the texture is hashed from it, not drawn from an RNG — so
 * seeking anywhere is exact and repeatable, and there is no accumulated state to rewind.
 */

/**
 * Session time per second of wall time.
 *
 * This used to be pinned at 1. The problem with 1 is arithmetic, not feel: a quiet EURUSD
 * minute covers about twelve points, so at real time the quote travels a fifth of a point a
 * second and the last digit changes roughly twice. That is genuinely what the tape did — but
 * it reads as a stalled number, and no amount of synthetic jitter fixes it, because jitter
 * around a stationary price is still a stationary price. The only honest lever is the clock.
 *
 * At 5x that same minute travels about a point a second, a normal one about four and a half,
 * and an M1 candle closes every twelve seconds — which is what makes the chart look like it
 * is trading.
 *
 * The cost is tape. The publisher adds thirty minutes of history every thirty minutes, so the
 * session now consumes it faster than it arrives and drains `(speed - 1)` seconds of runway
 * per second. That is not a failure mode — running out just holds the clock at the end of the
 * archive until the next publish, which `noteArchiveGrowth` already handles — but it is why
 * the default lookback below scales with this number rather than staying at two hours.
 *
 * Raise it for a faster tape, drop it to 1 for true real time. Nothing else needs to change:
 * every consumer keys off `tick.time`, not off wall-clock.
 */
export const PLAYBACK_SPEED = 5;

/**
 * The speed slider's snap points, as multiples of *normal* (`PLAYBACK_SPEED`), not of real time.
 *
 * Fifteen of them with normal dead in the middle, seven either side. Measured against wall
 * time they run from 0.25x to 1000x — slow enough to watch a single candle form tick by tick,
 * fast enough to cross a trading day in under a minute and a half.
 */
export const SPEED_STEPS = [
  0.05, 0.1, 0.2, 0.3, 0.4, 0.6, 0.8, 1, 2, 5, 10, 20, 50, 100, 200,
] as const;

export const NORMAL_SPEED = 1;

const SPEED_KEY = 'playback.speed';

/**
 * The largest bite of session time one emitted price may cover: exactly what a single frame
 * covers at normal speed.
 *
 * This is what keeps the order book honest when the slider is pushed right. At 200x normal a
 * frame spans about four market minutes; emitting one price for it would let a stop sit inside
 * a wick the engine never saw. Instead the frame is walked in normal-sized steps and every one
 * of them is priced and handed to the order engine, so stops, targets and pending orders are
 * sampled at the same density at every speed. Slower than normal needs nothing — a frame is
 * already smaller than this.
 */
const SUBSTEP_MS = 250 * PLAYBACK_SPEED;

/**
 * Safety valve for a tab that was throttled for a long time. Comfortably above what the top
 * speed needs per frame (~200); past it the remainder is covered in one leap, as before.
 */
const MAX_SUBSTEPS = 2_000;

function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return NORMAL_SPEED;
  return Math.min(SPEED_STEPS[SPEED_STEPS.length - 1], Math.max(SPEED_STEPS[0], speed));
}

/**
 * How often the clock is advanced and prices are emitted. Four times a second reads as live,
 * and sits inside the one-to-five prints a second a real major puts out.
 *
 * Deliberately not raised alongside the speed. Printing more often does not make the market
 * move faster, it only splits the same movement into smaller pieces — the thing that was
 * being mistaken for speed in the first place.
 *
 * Frames are elapsed-driven rather than counted, so they land at uneven offsets — which is
 * why the tick slots below do not divide evenly into this: a slot boundary the frames miss is
 * free irregularity in the cadence.
 */
const FRAME_MS = 250;

/**
 * Where the window starts by default: this far behind the newest bar held.
 *
 * Two hours, and the session plays from the moment it has bars. The terminal publishes every
 * thirty minutes, so a clock two hours back consumes tape at exactly the rate new tape
 * arrives — it never catches up and never runs dry. Opening the app therefore lands on a
 * market that is already moving, with two hours of runway in front of it, instead of a still
 * chart waiting to be told to start. Setting a start marker later just re-seats the clock
 * somewhere else in the same archive.
 */
const BASE_LOOKBACK_MS = 2 * 60 * 60 * 1000;

/**
 * Two hours of *runway*, not two hours of tape.
 *
 * At real time the two were the same thing: the clock consumed a minute a minute and the
 * publisher produced one, so a session never caught up and the distance behind never
 * mattered. Above 1x it drains at `(speed - 1)` per second, so holding the old fixed two
 * hours would give a 3x session one hour of play and a 5x session thirty minutes before it
 * parked on the end of the archive. Scaling by the drain rate keeps the answer to "how long
 * can this run before it waits" the same at every speed. The archive holds around 25 trading
 * days, so reaching further back costs nothing.
 */
const DEFAULT_LOOKBACK_MS = BASE_LOOKBACK_MS * Math.max(1, PLAYBACK_SPEED - 1);

/** A hole longer than this is a closed market, not a missing bar — jump it. */
const GAP_TOLERANCE_SECONDS = 90;

const SESSION_KEY = 'playback.session';

/** How often the clock is written down while playing. */
const PERSIST_MS = 5_000;

export interface PlaybackState {
  /** Unix ms. The margins of the tradeable window — the green and yellow dots. */
  startMs: number;
  endMs: number;
  /** Unix ms. Where the session has played to; the right edge of every chart. */
  clockMs: number;
  playing: boolean;
  /** True once there are bars to play. Charts show their loading state until then. */
  ready: boolean;
  /** Multiple of normal speed. 1 is the default rate; see `SPEED_STEPS`. */
  speed: number;
}

const IDLE: PlaybackState = {
  startMs: 0,
  endMs: 0,
  clockMs: 0,
  playing: false,
  ready: false,
  speed: NORMAL_SPEED,
};

/** The end is not stored: it is always wherever the archive currently reaches. */
interface StoredSession {
  startMs: number;
  clockMs: number;
  /**
   * Whether it was running when it was last written.
   *
   * Stored because "keep moving" is the default, not a command — a user who deliberately
   * paused to study a candle should not find it playing again next launch, and one who left
   * it running should not have to press play every time they open the app.
   */
  playing?: boolean;
}

export interface PlaybackOptions {
  /** Fires whenever any part of the state changes, so the transport can re-render. */
  onState?: (state: PlaybackState) => void;
  /**
   * Fires when the clock jumps rather than advances. Series have to be rebuilt from the
   * archive at the new moment — ticks alone cannot walk a chart backwards.
   */
  onSeek?: (clockMs: number) => void;
  /**
   * Fires when the jump went backwards, carrying the moment being jumped *to*.
   *
   * The target is the whole point of the argument. A rewind does not invalidate an account, it
   * invalidates the part of one that had not happened yet — a trade opened on Tuesday is still a
   * fact at Tuesday's clock, while one opened on Wednesday is not. Without the target the
   * listener cannot tell those apart and has no option but to delete everything.
   */
  onSeekBackwards?: (toMs: number) => void;
}

/**
 * Price inside one minute, as a pure function of how far through it the clock is.
 *
 * Three equal legs through the bar's own extremes. The order depends on direction, which is the
 * cheapest honest guess about what happened inside a minute nobody recorded ticks for: an up bar
 * dips to its low first, a down bar pops to its high first.
 */
function priceIn(bar: Candle, fraction: number, inset = 0): number {
  // The turn points are pulled in by `inset` so the ramp stops just short of the wick and the
  // texture below is what actually reaches it. Without that the ramp arrives at the exact
  // extreme and has nowhere left to move: every downward print at the low is squeezed to
  // nothing and the quote sits frozen on it for whole seconds, which is the artefact the
  // texture exists to remove. A bar's high and low are made by ticks, so let ticks make them.
  const high = bar.high - inset;
  const low = bar.low + inset;

  const legs =
    bar.close >= bar.open
      ? [bar.open, low, high, bar.close]
      : [bar.open, high, low, bar.close];

  const t = Math.min(0.999999, Math.max(0, fraction)) * 3;
  const leg = Math.floor(t);
  return legs[leg] + (legs[leg + 1] - legs[leg]) * (t - leg);
}

/* ------------------------------------------------------------------ */
/*  Tick texture                                                       */
/* ------------------------------------------------------------------ */
/**
 * The three legs above are the *shape* of a minute, not its tape.
 *
 * Walked on its own the ramp is a metronome: every print moves the same distance in the same
 * direction, so the quote counts rather than trades. Real tape does not do that. It flickers a
 * point and comes back, sits unchanged for two prints, then jumps three — the path is only
 * visible over seconds, and each individual tick is mostly noise around it.
 *
 * So a little texture is laid over the ramp. Two components, because one is not enough:
 *
 *   drift — smoothly interpolated, turning over about every 1.6s. This is what stops the
 *           noise reading as a buzz: the quote wanders a few points off the ramp and back
 *           rather than rattling around it.
 *   flick — one fresh value per tick slot. This is the print-to-print jitter, the part that
 *           makes two consecutive quotes differ by an uneven number of points.
 *
 * Both are hashed from the clock and the symbol rather than drawn from `Math.random`, which
 * matters more than it looks. Prices here are a pure function of the clock — that is what
 * makes seeking exact and lets `emitAll` re-run at an unchanged clock without inventing a new
 * price. A real RNG would break both: seeking to the same moment twice would print two
 * different quotes, and every symbol would re-roll on every repaint.
 */

/**
 * Session-ms per tick slot, scaled by the speed so a slot is a constant slice of *wall* time.
 *
 * Without the scaling the texture is a function of session time, so tripling the clock would
 * triple how fast it flickers and turn the wander into a buzz. Multiplying by the speed keeps
 * it deterministic — it is still a pure function of `clockMs` and a constant — while pinning
 * the flicker to what the eye actually sees.
 */
const TICK_SLOT_MS = 200 * PLAYBACK_SPEED;

/** Slots per drift turn — roughly 1.2s of wander. */
const DRIFT_SLOTS = 6;

/**
 * Split between the slow wander and the per-print flicker, weighted toward the flicker.
 *
 * The wander is what keeps the quote from buzzing, but too much of it is its own kind of
 * regularity: a smooth curve sampled every 250ms yields a run of similar-sized steps in the
 * same direction, which is the metronome again wearing a different hat. Two thirds flicker
 * measured best — it holds consecutive identical step sizes down to a few percent and caps
 * the longest run without a reversal at about four prints.
 */
const DRIFT_SHARE = 0.35;
const FLICK_SHARE = 0.65;

/**
 * How wide the texture is: a share of the minute's own range, floored so a quiet bar still
 * breathes. Scaling to the bar means a violent minute jitters more than a dead one, exactly
 * as a real feed does.
 *
 * The width has to stay ahead of what the ramp covers between prints, and that is why it grew
 * when the clock did. A texture narrower than one frame's worth of ramp travel is invisible:
 * every print lands the same distance further along the line and the quote strikes like a
 * clock regardless of how much noise is technically being added underneath.
 */
const TEXTURE_OF_RANGE = 0.18;
const TEXTURE_FLOOR_POINTS = 2.5;

const seedCache = new Map<string, number>();

/** FNV-1a over the symbol name. Cached — this runs for every symbol on every frame. */
function symbolSeed(symbol: string): number {
  const known = seedCache.get(symbol);
  if (known !== undefined) return known;

  let h = 2166136261;
  for (let i = 0; i < symbol.length; i += 1) {
    h ^= symbol.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  const seed = h >>> 0;
  seedCache.set(symbol, seed);
  return seed;
}

/** Deterministic [-1, 1) from a seed and a slot number. */
function noise(seed: number, slot: number): number {
  let h = Math.imul(seed ^ slot, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39);
  return (((h ^ (h >>> 16)) >>> 0) / 2147483648) - 1;
}

/** Value noise with a smoothstep between slots, so the wander has no corners. */
function smoothNoise(seed: number, position: number): number {
  const slot = Math.floor(position);
  const f = position - slot;
  const eased = f * f * (3 - 2 * f);
  const a = noise(seed, slot);
  const b = noise(seed, slot + 1);
  return a + (b - a) * eased;
}

/**
 * The offset to add to the ramp price, in price units.
 *
 * Returns zero width for a bar that genuinely did not move — a flat minute should print flat,
 * and inventing movement inside one would be fiction rather than texture.
 */
function textureWidth(bar: Candle, point: number): number {
  return Math.max(TEXTURE_FLOOR_POINTS * point, (bar.high - bar.low) * TEXTURE_OF_RANGE);
}

function tickTexture(symbol: string, clockMs: number, width: number): number {
  if (width <= 0) return 0;

  const seed = symbolSeed(symbol);
  const slot = clockMs / TICK_SLOT_MS;

  const drift = smoothNoise(seed ^ 0x9e3779b9, slot / DRIFT_SLOTS);
  const flick = noise(seed, Math.floor(slot));

  return (drift * DRIFT_SHARE + flick * FLICK_SHARE) * width;
}

/* ------------------------------------------------------------------ */
/*  The price, at any moment                                           */
/* ------------------------------------------------------------------ */
/**
 * What this symbol is quoted at when the clock reads `clockMs`.
 *
 * A pure function of the symbol and the clock, and the *only* place a price is composed — the
 * session's own tick loop calls it too. That single-implementation rule is the point: the
 * autotrader reads prices ahead of the clock to decide whether a trade would pay, and a
 * lookahead computed by a second copy of this arithmetic would be a bot trading against a
 * market slightly different from the one the user is watching. There is no second copy.
 *
 * Reads freely into the future. Nothing here consults the session's position — the archive is
 * already on the device and the intra-minute path is deterministic, so `clockMs` two minutes
 * ahead is answered exactly as confidently as `clockMs` now. What makes that safe rather than
 * cheating is who is allowed to ask: see `lib/trading/autotrader.ts`.
 *
 * Returns `null` for a symbol with no bar covering that moment.
 */
export function priceAtClock(symbol: string, clockMs: number): { bid: number; ask: number } | null {
  // Whole seconds for the *lookup* — bars are bucketed per minute. The position inside the bar
  // is taken from the raw clock instead: flooring it there was what made the quote step once a
  // second and hold for four frames, so the tape counted rather than ticked.
  const at = barAt(symbol, Math.floor(clockMs / 1000));
  if (!at) return null;

  const instrument = findInstrument(symbol);
  const point = instrument?.point ?? 0.00001;
  const spread = (instrument?.spread ?? 10) * point;

  // Outside a covered minute the price is simply the last one printed — a closed market does
  // not drift.
  if (!at.covers) return { bid: at.bar.close, ask: at.bar.close + spread };

  const fraction = (clockMs / 1000 - at.bar.time) / 60;

  // Never more than a third of the bar: on a very tight minute an inset the full width of the
  // texture would invert the turn points and run the ramp backwards.
  const width = textureWidth(at.bar, point);
  const inset = Math.min(width, (at.bar.high - at.bar.low) / 3);

  const ramp = priceIn(at.bar, fraction, inset);
  const offset = tickTexture(symbol, clockMs, width);

  // The bar's own extremes are the envelope, and staying inside is not cosmetic: the forming
  // candle on the chart is built from these ticks, so a print past the archived high or low
  // would draw a wick that vanishes the next time the series re-seeds.
  //
  // Squeezed toward the edge rather than cut off at it. A hard clamp parks the quote on the
  // extreme for as long as the texture points that way -- which showed up as runs of six or
  // seven identical prints exactly where the ramp is nearest a wick, the frozen look this is
  // meant to cure. Soft-clipping instead just shrinks the texture as room runs out, which is
  // also what a real bar does: prints thin out near its extreme because that extreme is, by
  // definition, as far as any tick got.
  const room = offset >= 0 ? at.bar.high - ramp : ramp - at.bar.low;
  const held = ramp + (room > 0 ? (offset * room) / (room + Math.abs(offset)) : 0);

  // Land on a real increment. A quote carrying float dust below the last displayed digit reads
  // as continuous drift; snapping to the point is what makes a print a *tick*, and is what lets
  // two adjacent frames legitimately show the same price.
  const bid = Math.round(held / point) * point;
  return { bid, ask: bid + spread };
}

export class PlaybackSession {
  private state: PlaybackState = IDLE;
  private symbols: string[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Wall-clock reading of the previous frame, so the session advances by real elapsed time. */
  private lastFrame = 0;
  private lastPersist = 0;
  /** Set when the clock stopped only because it ran out of tape, never by a user pause. */
  private autoResume = false;

  private onTick: TickHandler;
  private options: PlaybackOptions;

  constructor(onTick: TickHandler, options: PlaybackOptions = {}) {
    this.onTick = onTick;
    this.options = options;
    // Stored apart from the session: the speed is a preference, not part of a window, so a
    // wipe or a fresh layout must not put it back to normal.
    this.state = { ...IDLE, speed: clampSpeed(readSetting<number>(SPEED_KEY, NORMAL_SPEED)) };
  }

  getState(): PlaybackState {
    return this.state;
  }

  get clockMs(): number {
    return this.state.clockMs;
  }

  /**
   * Restore the window, or lay a fresh one out over whatever the device holds.
   *
   * Called once the archives are loaded. A saved session is kept only if the archive still
   * covers it — a depth change or a wipe can leave a stored clock pointing at bars that no
   * longer exist, and silently playing the wrong data is worse than starting again.
   */
  init(symbols: string[]): void {
    this.symbols = [...symbols];

    const bounds = this.archiveBounds();
    if (!bounds) {
      this.patch({ ...IDLE, ready: false, speed: this.state.speed });
      return;
    }

    const stored = readSetting<StoredSession | null>(SESSION_KEY, null);
    const usable =
      stored &&
      stored.clockMs >= bounds.fromMs &&
      stored.clockMs <= bounds.toMs &&
      stored.startMs >= bounds.fromMs;

    if (usable) {
      this.patch({
        startMs: stored.startMs,
        endMs: bounds.toMs,
        clockMs: stored.clockMs,
        playing: false,
        ready: true,
      });
      this.options.onSeek?.(this.state.clockMs);
      this.emitAll();
      // Anything but an explicit pause resumes. `playing` is absent in sessions stored before
      // this existed, and those should start moving too.
      if (stored.playing !== false) this.play();
      return;
    }

    // Fresh: two hours of runway behind the newest bar the device holds, already running.
    const startMs = Math.max(bounds.fromMs, bounds.toMs - DEFAULT_LOOKBACK_MS);
    this.patch({
      startMs,
      endMs: bounds.toMs,
      clockMs: startMs,
      playing: false,
      ready: true,
    });
    this.options.onSeek?.(startMs);
    this.emitAll();
    this.play();
  }

  setSymbols(symbols: string[]): void {
    this.symbols = [...symbols];
  }

  /**
   * Forget the window and everything played.
   *
   * Used when the archives are thrown away: a stored clock pointing into bars that no longer
   * exist would either refuse to lay out or play data it should not. The next archive to land
   * lays out a fresh window from scratch.
   */
  reset(): void {
    this.pause();
    writeSetting<StoredSession | null>(SESSION_KEY, null);
    this.patch({ ...IDLE, speed: this.state.speed });
  }

  /**
   * Change how fast the clock runs. Takes effect on the next frame, playing or not.
   *
   * Only the rate changes — no seek, no reseed, nothing about the book. Every consumer keys off
   * `tick.time`, so a faster clock is simply more market per second.
   */
  setSpeed(speed: number): void {
    const next = clampSpeed(speed);
    if (next === this.state.speed) return;
    this.patch({ speed: next });
    writeSetting<number>(SPEED_KEY, next);
  }

  /* ---------- transport ---------- */

  play(): void {
    if (this.state.playing || !this.state.ready) return;
    if (this.state.clockMs >= this.state.endMs) return; // nothing left to reveal

    this.lastFrame = Date.now();
    this.timer = setInterval(() => this.frame(), FRAME_MS);
    // Running by intent, so running again after the next publish is also by intent. Only an
    // explicit pause clears this.
    this.autoResume = true;
    this.patch({ playing: true });
  }

  pause(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.state.playing) return;

    this.patch({ playing: false });
    this.persist();
  }

  toggle(): void {
    if (this.state.playing) {
      // An explicit pause outranks "keep moving": the session must not restart itself the
      // moment the next thirty-minute publish lands.
      this.autoResume = false;
      this.pause();
    } else {
      this.play();
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.state = { ...this.state, playing: false };
  }

  /**
   * Move the clock without moving the margins.
   *
   * A backwards jump wipes the book — see `onSeekBackwards`. It happens before the clock moves
   * so nothing can price itself against the new moment while the old positions still exist.
   */
  seekTo(ms: number): void {
    const target = Math.min(this.state.endMs, Math.max(this.state.startMs, ms));
    if (target === this.state.clockMs) return;

    const backwards = target < this.state.clockMs;
    if (backwards) this.options.onSeekBackwards?.(target);

    this.patch({ clockMs: target });
    this.options.onSeek?.(target);
    this.emitAll();
    this.persist();
  }

  /**
   * Move the green dot. Playback begins there, so the clock is re-seated with it.
   *
   * Dragging it back into candles already traded is a backwards seek by another name, and is
   * treated as one.
   */
  setStart(ms: number): void {
    const bounds = this.archiveBounds();
    if (!bounds) return;

    const start = Math.min(this.state.endMs - 60_000, Math.max(bounds.fromMs, ms));

    // Unchanged is not a move: re-sending the start the session already has must not read as a
    // rewind, which would clear the book for nothing.
    if (start === this.state.startMs) return;

    if (start < this.state.clockMs) this.options.onSeekBackwards?.(start);

    this.patch({ startMs: start, clockMs: start });
    this.options.onSeek?.(start);
    this.emitAll();
    this.persist();
  }

  /**
   * Called after a refresh has appended bars.
   *
   * This is what keeps a running session from ever stalling: the thirty-minute download extends
   * the tape, and the end margin follows it, so playing at wall-clock rate a few hours behind
   * the present can continue indefinitely.
   */
  noteArchiveGrowth(): void {
    const bounds = this.archiveBounds();
    if (!bounds) return;

    if (!this.state.ready) {
      this.init(this.symbols);
      return;
    }

    if (bounds.toMs > this.state.endMs) {
      this.patch({ endMs: bounds.toMs });

      // Waiting at the end of the tape when more of it arrives. This is the ordinary case,
      // not an edge one: the clock runs at real time and the publisher adds thirty minutes
      // every thirty minutes, so any device that was briefly offline lands here.
      if (this.autoResume && !this.state.playing) this.play();
    }
  }

  /* ---------- the loop ---------- */

  private frame(): void {
    const now = Date.now();
    const elapsed = Math.max(0, now - this.lastFrame);
    this.lastFrame = now;

    // Elapsed wall time, scaled. Driven by real elapsed rather than by a per-frame constant so
    // a throttled background tab or a dropped frame costs no session time -- it catches up on
    // the next frame instead of quietly running slow.
    const target = this.state.clockMs + elapsed * PLAYBACK_SPEED * this.state.speed;

    // Walked in normal-sized steps, each one priced — see `SUBSTEP_MS`. At normal speed or
    // slower this is a single step and behaves exactly as it always did.
    let clock = this.state.clockMs;
    let steps = 0;

    while (clock < target) {
      steps += 1;
      let next = steps >= MAX_SUBSTEPS ? target : Math.min(target, clock + SUBSTEP_MS);

      // Nothing to show at this instant for any symbol: the market is shut. Jump to whenever it
      // opens again rather than spending real days crossing a weekend at one second per second.
      const jumped = this.skipGap(next);
      if (jumped > 0) next = jumped;

      if (next >= this.state.endMs) {
        // Played to the end of the tape. Held here rather than stopped for good: the next
        // publish extends the archive and `noteArchiveGrowth` starts it moving again, so a
        // session left open simply carries on when the terminal catches up.
        this.patch({ clockMs: this.state.endMs });
        if (jumped > 0) this.options.onSeek?.(this.state.endMs);
        this.emitAll();
        this.autoResume = true;
        this.pause();
        return;
      }

      this.patch({ clockMs: next });

      // After the clock has moved, never before: the series are rebuilt at whatever the session
      // now reads, and announcing the jump early would rebuild them at the moment just left.
      if (jumped > 0) this.options.onSeek?.(next);

      this.emitAll();
      clock = next;

      // A weekend crossed ends the frame. The rest of its budget would otherwise be spent
      // racing through Monday's open before the chart has even redrawn it.
      if (jumped > 0) break;
    }

    if (now - this.lastPersist >= PERSIST_MS) this.persist();
  }

  /**
   * Where the market next opens, if it is shut at `clockMs`.
   *
   * Coverage is asked of every tracked symbol, not one: crypto trades through the weekend, so a
   * session watching both bitcoin and gold must keep running — gold simply holds its Friday
   * close, exactly as a real quote board shows it.
   */
  private skipGap(clockMs: number): number {
    const seconds = Math.floor(clockMs / 1000);

    let anyCovered = false;
    let earliestNext = 0;

    for (const symbol of this.symbols) {
      const at = barAt(symbol, seconds);
      if (at?.covers) {
        anyCovered = true;
        break;
      }
      const next = nextBarTime(symbol, seconds);
      if (next > 0 && (earliestNext === 0 || next < earliestNext)) earliestNext = next;
    }

    if (anyCovered || earliestNext === 0) return 0;
    if (earliestNext * 1000 - clockMs < GAP_TOLERANCE_SECONDS * 1000) return 0;

    return earliestNext * 1000;
  }

  /** One price per symbol at the current clock. */
  private emitAll(): void {
    const clockMs = this.state.clockMs;
    if (!clockMs) return;

    // The arithmetic lives in `priceAtClock` so that the autotrader's lookahead and the tape
    // the user is watching cannot come apart. See there.
    for (const symbol of this.symbols) {
      const price = priceAtClock(symbol, clockMs);
      if (!price) continue;

      const tick: Tick = { symbol, bid: price.bid, ask: price.ask, time: clockMs };
      this.onTick(tick);
    }
  }

  /* ---------- bounds and persistence ---------- */

  /** Oldest and newest bar across every tracked symbol, in ms. */
  private archiveBounds(): { fromMs: number; toMs: number } | null {
    let from = 0;
    let to = 0;

    for (const symbol of this.symbols) {
      const range = archiveRange(symbol);
      if (range.count === 0) continue;
      if (from === 0 || range.from < from) from = range.from;
      if (range.to > to) to = range.to;
    }

    return to === 0 ? null : { fromMs: from * 1000, toMs: to * 1000 };
  }

  private patch(next: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...next };
    this.options.onState?.(this.state);
  }

  private persist(): void {
    this.lastPersist = Date.now();
    if (!this.state.ready) return;

    writeSetting<StoredSession>(SESSION_KEY, {
      startMs: this.state.startMs,
      clockMs: this.state.clockMs,
      playing: this.state.playing || this.autoResume,
    });
  }
}
