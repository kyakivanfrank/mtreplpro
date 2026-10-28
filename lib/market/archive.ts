'use client';

import { dbClear, dbDelete, dbGet, dbKeys, dbSet } from '@/lib/db';
import { rollup } from './candles';
import { sessionOffsetFor, TIMEFRAMES } from './timeframes';
import type { Candle, TimeframeKey } from './types';

/* ------------------------------------------------------------------ */
/*  The minute archive                                                 */
/* ------------------------------------------------------------------ */
/**
 * One deep M1 archive per symbol — the only market data the app reads.
 *
 * Nothing here is live. The bridge fills this store and the charts play it back, which is the
 * whole point: a bar being re-synced underneath a running chart is what makes M1 trading
 * unusable, so the socket is a downloader and the archive is the tape.
 *
 * Minute bars rather than ticks. Ticks are two to three orders of magnitude more bytes for the
 * same window, and a month of them per symbol is not something to keep in a browser. M1 OHLC is
 * what MT5's own tester models from, it maps onto every timeframe by bucketing alone, and the
 * motion inside a minute is synthesized on playback (open, high, low, close).
 *
 * Fixed capacity, oldest-out. Each refresh pushes the newest bars and pops the same number off
 * the front, so the store is a queue that never grows: the large download happens once per
 * symbol per device, and from then on only the tail moves. A full download happens in exactly
 * two cases — the local data was deleted, or a symbol was newly added to the watchlist.
 */

/* ------------------------------------------------------------------ */
/*  Depth                                                              */
/* ------------------------------------------------------------------ */
/**
 * How deep the archive goes — decided by the publisher, not by this device.
 *
 * This was a setting once, with a slider and a destructive re-download behind it. It could
 * only ever disagree with reality: the VPS publishes a fixed window and pops the far end of
 * it every cycle, so a device asking for 150 days of a 25-day feed was asking for something
 * nobody was ever going to send. Worse, the two counted differently — the setting in bars
 * (`days x 1440`), the publisher in calendar days — so on forex, where weekends carry no
 * bars at all, "30 days" locally meant about forty on the tape.
 *
 * Now there is one number, it arrives with the data in `mt5:meta`, and it is counted in
 * *candles* rather than days — because a day is not a fixed amount of chart. Crypto trades
 * seven days a week and forex five, so "25 days" meant 36,000 minutes of BTCUSD and about
 * 26,000 of EURUSD: a third less history on the pair most likely to be on screen. Counted
 * in candles the guarantee holds for every symbol whatever its calendar, and forex simply
 * reaches further back to meet it.
 */
const MINUTES_PER_DAY = 1_440;

const DEFAULT_CANDLES = 25 * MINUTES_PER_DAY;

/** Set from `mt5:meta` as soon as the catalogue lands; the default only covers the gap. */
let publishedCandles = DEFAULT_CANDLES;

export function setPublishedCandles(candles: number): void {
  if (Number.isFinite(candles) && candles > 0) publishedCandles = Math.round(candles);
}

/** The guaranteed depth, in minute candles. The figure both sides are held to. */
export function archiveCandles(): number {
  return publishedCandles;
}

/**
 * The same depth expressed in days, for somewhere a person reads it.
 *
 * Display only, and approximate on purpose — the honest answer for forex is "about 35
 * calendar days, of which 25 days' worth are trading minutes", which is not a settings row.
 */
export function archiveDays(): number {
  return Math.round(publishedCandles / MINUTES_PER_DAY);
}

/**
 * Ceiling on stored candles per symbol — and the whole trimming mechanism.
 *
 * Exactly the published depth, not one candle more. That equality is what lets the two ends
 * agree without exchanging anything: the publisher counts the newest `n` candles it holds,
 * this device keeps the newest `n` candles it holds, and since they are the same series the
 * per-day counts come out identical on both sides. So the day the queue starts inside needs
 * no floor, no boundary timestamp and no re-download as candles pop off it — the cap alone
 * lands on the same number the manifest already says.
 */
export function archiveBars(): number {
  return publishedCandles;
}

export interface M1Archive {
  symbol: string;
  /** Price precision the integers below are scaled by. */
  digits: number;
  /** Unix seconds, strictly ascending. */
  t: Float64Array;
  o: Int32Array;
  h: Int32Array;
  l: Int32Array;
  c: Int32Array;
  /**
   * `{"2026-08-22": 1440}` — how many bars this device actually holds for each day.
   *
   * The same shape the publisher writes into `mt5:manifest`, and the whole basis of the
   * sync: comparing the two says exactly which days have moved since this archive was last
   * touched, so the device asks for those and nothing else. Counted from the bars that were
   * really stored rather than copied from the manifest, which is what makes it self-correcting
   * — a day that arrives short stays short here, so it is simply asked for again next pass.
   */
  days: Record<string, number>;
  savedAt: number;
}

/** The UTC date a bar belongs to. Matches the publisher's `bar_time // 86400` bucketing. */
export function dayName(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/** What this device holds per day, for diffing against the published manifest. */
export function heldDays(symbol: string): Record<string, number> {
  return memory.get(symbol)?.days ?? {};
}

/**
 * Prices are integers scaled by the instrument's precision.
 *
 * Not for space at this size — for equality. 1.13169 round-tripped as a float can come back a
 * fraction out, and a bar that decodes differently from how it encoded looks *changed* to the
 * merge below, which would then write a duplicate on every refresh.
 */
function scaleOf(digits: number): number {
  return 10 ** digits;
}

const memory = new Map<string, M1Archive>();

/* ------------------------------------------------------------------ */
/*  Read                                                               */
/* ------------------------------------------------------------------ */

/** Load one symbol's archive, from memory if it has already been read this session. */
export async function loadArchive(symbol: string): Promise<M1Archive | undefined> {
  const cached = memory.get(symbol);
  if (cached) return cached;

  const stored = await dbGet<M1Archive>('m1', symbol);
  if (!stored) return undefined;

  memory.set(symbol, stored);
  return stored;
}

/** Warm the in-memory map so the first render after launch already has bars. */
export async function primeArchives(symbols?: string[]): Promise<void> {
  const keys = symbols ?? (await dbKeys('m1'));
  await Promise.all(keys.map((symbol) => loadArchive(symbol)));
}

export interface ArchiveRange {
  /** Unix seconds of the oldest and newest bar held, both 0 when empty. */
  from: number;
  to: number;
  count: number;
}

export function archiveRange(symbol: string): ArchiveRange {
  const archive = memory.get(symbol);
  if (!archive || archive.t.length === 0) return { from: 0, to: 0, count: 0 };
  return { from: archive.t[0], to: archive.t[archive.t.length - 1], count: archive.t.length };
}

/** Index of the last bar at or before `seconds`, or -1 when every bar is newer. */
function indexAtOrBefore(t: Float64Array, seconds: number): number {
  let lo = 0;
  let hi = t.length - 1;
  let found = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= seconds) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return found;
}

function decode(archive: M1Archive, start: number, end: number): Candle[] {
  const scale = scaleOf(archive.digits);
  const out: Candle[] = [];

  for (let i = start; i <= end; i++) {
    out.push({
      time: archive.t[i],
      open: archive.o[i] / scale,
      high: archive.h[i] / scale,
      low: archive.l[i] / scale,
      close: archive.c[i] / scale,
    });
  }

  return out;
}

/**
 * The series a chart should draw at a given moment of playback.
 *
 * Everything after `clockSeconds` is withheld — those minutes have not happened yet as far as
 * the session is concerned, and letting one leak onto the chart would show the user the future
 * they are trading into. The final bar is deliberately partial: it is rolled from only the
 * minutes up to the clock, which is exactly how a forming bar behaves on a live chart.
 */
export function seriesAt(
  symbol: string,
  timeframe: TimeframeKey,
  clockSeconds: number,
  maxBars: number
): Candle[] {
  const archive = memory.get(symbol);
  if (!archive || archive.t.length === 0) return [];

  const end = indexAtOrBefore(archive.t, clockSeconds);
  if (end < 0) return [];

  // One coarse bar is `tfSeconds / 60` minutes, so this is the minute count that can fill the
  // bars asked for — plus one bar's worth, since the oldest bucket is usually entered part-way.
  const tfSeconds = TIMEFRAMES[timeframe].seconds;
  const minutesPerBar = Math.max(1, Math.round(tfSeconds / 60));
  const span = (maxBars + 1) * minutesPerBar;
  const start = Math.max(0, end - span + 1);

  const m1 = decode(archive, start, end);
  if (tfSeconds <= 60) return m1.slice(-maxBars);

  return rollup(m1, tfSeconds, sessionOffsetFor(timeframe)).slice(-maxBars);
}

/**
 * The minute bar covering `seconds`, or the last one before it.
 *
 * `covers` is the difference that matters to playback. True means the clock is inside this
 * minute and the price should be moving through it; false means the market was closed or the
 * archive has a hole there, and the price simply holds at that bar's close — which is what a
 * quote does over a weekend.
 */
export function barAt(
  symbol: string,
  seconds: number
): { bar: Candle; covers: boolean } | undefined {
  const archive = memory.get(symbol);
  if (!archive || archive.t.length === 0) return undefined;

  const at = indexAtOrBefore(archive.t, seconds);
  if (at < 0) return undefined;

  const [bar] = decode(archive, at, at);
  return { bar, covers: bar.time + 60 > seconds };
}

/**
 * How many bars of a timeframe actually sit inside a window.
 *
 * Counted from the minutes held, not derived from elapsed time, because those are different
 * numbers and the difference is the whole point: four hours across a Friday night is four
 * hours of clock and no bars at all. Sizing a tradable window off the calendar would promise
 * a session that mostly is not there.
 */
export function countBars(
  symbol: string,
  fromSeconds: number,
  toSeconds: number,
  tfSeconds: number
): number {
  const archive = memory.get(symbol);
  if (!archive || archive.t.length === 0) return 0;

  const end = indexAtOrBefore(archive.t, toSeconds);
  if (end < 0) return 0;

  const start = indexAtOrBefore(archive.t, fromSeconds - 1) + 1;
  if (start > end) return 0;

  if (tfSeconds <= 60) return end - start + 1;

  let bars = 0;
  let bucket = -1;
  for (let i = start; i <= end; i++) {
    const slot = Math.floor(archive.t[i] / tfSeconds);
    if (slot !== bucket) {
      bucket = slot;
      bars++;
    }
  }

  return bars;
}

/**
 * The next minute at or after `seconds`, or 0 when the archive ends first.
 *
 * This is what makes a weekend cost nothing. The clock runs at wall-clock rate, so a Friday to
 * Sunday hole would otherwise take two real days to cross; the session asks where the next bar
 * actually is and jumps straight to it.
 */
export function nextBarTime(symbol: string, seconds: number): number {
  const archive = memory.get(symbol);
  if (!archive || archive.t.length === 0) return 0;

  const next = indexAtOrBefore(archive.t, seconds - 1) + 1;
  return next < archive.t.length ? archive.t[next] : 0;
}

/* ------------------------------------------------------------------ */
/*  Write                                                              */
/* ------------------------------------------------------------------ */

/**
 * Fold a CSV response into the archive and persist it.
 *
 * The text is exactly what the terminal wrote — `t,o,h,l,c,v`, one candle per line, any
 * number of days concatenated. Lines are parsed straight into the scaled integers below,
 * so nothing between the socket and storage ever builds an object per bar; a full 25-day
 * window is 36,000 lines and the difference is worth having on a phone.
 *
 * Bars may arrive in any order, overlapping or not. Existing bars lose to incoming ones on
 * the same timestamp — a bar that was still forming when it was stored is corrected rather
 * than duplicated.
 *
 * Push and pop happen here, in one step. New candles merge in at the front and the oldest
 * fall off the back the moment the total exceeds the published depth, so the archive is a
 * fixed-length queue that mirrors the publisher's own rather than growing forever.
 */
export async function applyCsv(
  symbol: string,
  digits: number,
  text: string
): Promise<M1Archive | undefined> {
  if (typeof text !== 'string' || text.length === 0) return memory.get(symbol);

  const scale = scaleOf(digits);
  const existing = memory.get(symbol) ?? (await loadArchive(symbol));

  // Merged through a map keyed by bar time: it makes the overlap rule a single assignment, and
  // the sort afterwards costs nothing next to the round trip that produced these rows.
  const merged = new Map<number, [number, number, number, number]>();

  if (existing) {
    // A digits change would leave the two sets scaled differently, so the stored bars are
    // rescaled onto the incoming precision rather than silently mixed with it.
    const ratio = scale / scaleOf(existing.digits);
    for (let i = 0; i < existing.t.length; i++) {
      merged.set(existing.t[i], [
        Math.round(existing.o[i] * ratio),
        Math.round(existing.h[i] * ratio),
        Math.round(existing.l[i] * ratio),
        Math.round(existing.c[i] * ratio),
      ]);
    }
  }

  for (const line of text.split('\n')) {
    if (line.length === 0) continue;

    const field = line.split(',');
    if (field.length < 5) continue; // a truncated line is skipped, not guessed at

    const time = Number(field[0]);
    const open = Number(field[1]);
    const high = Number(field[2]);
    const low = Number(field[3]);
    const close = Number(field[4]);

    // A malformed line is dropped rather than stored. `Number('')` is 0 and a typed array
    // turns NaN into 0 without complaint, so an unchecked parse would write a bar priced at
    // zero into the middle of the tape — which draws as a spike to the floor of the chart.
    if (!Number.isFinite(time) || time <= 0) continue;
    if (!Number.isFinite(open) || !Number.isFinite(high)) continue;
    if (!Number.isFinite(low) || !Number.isFinite(close)) continue;

    merged.set(time, [
      Math.round(open * scale),
      Math.round(high * scale),
      Math.round(low * scale),
      Math.round(close * scale),
    ]);
  }

  // Pop the far end. The publisher counts the newest `capacity` candles of this same series,
  // so taking the newest `capacity` here lands on exactly the same set — which is what makes
  // the day counts below match the manifest without either side sending the other a boundary.
  const capacity = archiveBars();
  const times = Array.from(merged.keys()).sort((a, b) => a - b);
  const kept = times.length > capacity ? times.slice(times.length - capacity) : times;
  const n = kept.length;

  const archive: M1Archive = {
    symbol,
    digits,
    t: new Float64Array(n),
    o: new Int32Array(n),
    h: new Int32Array(n),
    l: new Int32Array(n),
    c: new Int32Array(n),
    days: {},
    savedAt: Date.now(),
  };

  for (let i = 0; i < n; i++) {
    const time = kept[i];
    const bar = merged.get(time)!;
    archive.t[i] = time;
    archive.o[i] = bar[0];
    archive.h[i] = bar[1];
    archive.l[i] = bar[2];
    archive.c[i] = bar[3];

    // Recounted from what was actually kept, after the floor and the cap have both had
    // their say. Copying the publisher's counts across instead would have this device
    // claim to hold days it had just trimmed, and it would never ask for them again.
    const day = dayName(time);
    archive.days[day] = (archive.days[day] ?? 0) + 1;
  }

  memory.set(symbol, archive);
  await dbSet('m1', symbol, archive);
  return archive;
}

/** Drop every archive on the device — the depth changed, so all of them are the wrong size. */
export async function wipeAllArchives(): Promise<void> {
  memory.clear();
  await dbClear('m1');
}

/** Whether this symbol still needs its one large download. */
export function needsFullDownload(symbol: string): boolean {
  const archive = memory.get(symbol);
  return !archive || archive.t.length === 0;
}
