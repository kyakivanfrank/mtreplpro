import type { TimeframeKey } from './types';

/**
 * Seconds per bar.
 *
 * Every timeframe is bucketed from one place: the minute archive the device holds locally.
 * Nothing is downloaded per-timeframe any more, so there is no provider interval to name —
 * one array, one bucketing rule, nine views of it, which is what keeps them from disagreeing
 * about where an H4 bar starts.
 *
 * `MN` is the exception the rule has to carry: a month is not a number of seconds. Its entry
 * below is a *nominal* thirty days, used only where a length estimate is wanted — how many
 * minutes to decode to fill a screen — and never as a bucket width. `bucketStartOffset` sees
 * that value and switches to the calendar instead; see `MONTH_SECONDS`.
 */
export const TIMEFRAMES: Record<TimeframeKey, { seconds: number; label: string }> = {
  M1: { seconds: 60, label: 'M1' },
  M5: { seconds: 300, label: 'M5' },
  M15: { seconds: 900, label: 'M15' },
  M30: { seconds: 1800, label: 'M30' },
  H1: { seconds: 3600, label: 'H1' },
  H4: { seconds: 14400, label: 'H4' },
  D1: { seconds: 86400, label: 'D1' },
  W1: { seconds: 604800, label: 'W1' },
  MN: { seconds: 2_592_000, label: 'MN' },
};

/**
 * The sentinel that means "calendar month, not a span".
 *
 * Kept as a named constant rather than compared against `TIMEFRAMES.MN.seconds` inline, because
 * the whole point is that the number is a stand-in and every place that treats it as a duration
 * is either sizing a decode or wrong.
 */
export const MONTH_SECONDS = TIMEFRAMES.MN.seconds;

/** The bar bucket a timestamp belongs to, as unix seconds. */
export function bucketStart(unixSeconds: number, tfSeconds: number): number {
  return Math.floor(unixSeconds / tfSeconds) * tfSeconds;
}

/**
 * Where a forex trading day begins, in seconds past midnight UTC.
 *
 * 21:00 — the same instant the week opens on Sunday and closes on Friday. Bucketing daily bars
 * on midnight instead would split every session in two: the hours from 21:00 to midnight belong
 * to the next trading day everywhere in the industry, and a D1 candle cut at 00:00 matches no
 * broker, no other chart, and not even this app's own week boundary.
 */
export const FOREX_DAY_OFFSET_SECONDS = 21 * 3600;

/**
 * Where a forex week begins, as an offset into the epoch's own week grid.
 *
 * Weeks bucketed on bare unix time start on a Thursday — 1 January 1970 was one — which would
 * cut every weekly candle through the middle of Wednesday's session. 334800 is Sunday 4 January
 * 1970 at 21:00 UTC, the first week open the epoch contains, so `floor()` against it lands every
 * bar on the Sunday 21:00 the market actually opens at, the same instant `FOREX_DAY_OFFSET`
 * names for the day.
 */
export const FOREX_WEEK_OFFSET_SECONDS = 3 * 86400 + 21 * 3600;

/**
 * The session offset a timeframe buckets against.
 *
 * One place rather than the two `timeframe === 'D1' ? … : 0` ternaries this used to be — the
 * archive's rollup and the live series' own bucketing have to agree exactly, or a tick opens a
 * second bar beside the one the archive laid down.
 */
export function sessionOffsetFor(timeframe: TimeframeKey): number {
  if (timeframe === 'D1') return FOREX_DAY_OFFSET_SECONDS;
  if (timeframe === 'W1') return FOREX_WEEK_OFFSET_SECONDS;
  // MN carries the day offset too, but applies it through the calendar rather than by
  // subtraction — see `bucketStartOffset`.
  if (timeframe === 'MN') return FOREX_DAY_OFFSET_SECONDS;
  return 0;
}

/**
 * The first instant of the calendar month containing `unixSeconds`, on the session grid.
 *
 * The offset is applied before the month is read and added back after, so a monthly bar opens
 * at 21:00 on the last day of the previous month — exactly where that month's first daily bar
 * opens. Anchoring on midnight of the 1st instead would leave the three hours between 21:00 and
 * midnight in the wrong month, which is a sliver at this scale but is the kind of sliver that
 * makes a monthly open disagree with the daily open printed under it.
 */
export function monthStart(unixSeconds: number, offsetSeconds: number): number {
  const shifted = new Date((unixSeconds - offsetSeconds) * 1000);
  const start = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) / 1000;
  return start + offsetSeconds;
}

/**
 * Bucket a timestamp, honouring the session offset.
 *
 * Intraday timeframes divide the day evenly and land on the same boundary either way, so they
 * are handed an offset of 0 and take the plain path. D1, W1 and MN are the three that shift.
 */
export function bucketStartOffset(
  unixSeconds: number,
  tfSeconds: number,
  offsetSeconds: number
): number {
  // A month has no width to floor against. It is the one bucket read off the calendar.
  if (tfSeconds === MONTH_SECONDS) return monthStart(unixSeconds, offsetSeconds);

  if (offsetSeconds === 0) return bucketStart(unixSeconds, tfSeconds);
  return bucketStart(unixSeconds - offsetSeconds, tfSeconds) + offsetSeconds;
}
