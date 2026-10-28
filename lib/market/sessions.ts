import { findInstrument } from '@/lib/instruments';
import type { Candle } from './types';

/* ------------------------------------------------------------------ */
/*  Trading sessions                                                   */
/* ------------------------------------------------------------------ */
/**
 * Twelve Data returns a full 1,440 M1 bars every Saturday for spot FX — with real-looking
 * OHLC movement — because it aggregates a 24/7 source rather than an exchange session feed.
 * MT5 shows nothing there: the forex week runs Sunday evening to Friday evening, and the
 * chart simply skips the gap.
 *
 * So bars are filtered against the session calendar before they ever reach a series. That
 * keeps the weekend out of the chart, out of the H/L range, and out of a backtest — where a
 * fill on a Saturday would be pure fiction.
 */

export type SessionKind = 'forex' | 'crypto';

/** Forex week, UTC: opens Sunday 21:00, closes Friday 21:00 — the usual broker convention. */
const WEEK_OPEN_HOUR = 21;   // Sunday
const WEEK_CLOSE_HOUR = 21;  // Friday

export function sessionKindFor(symbol: string): SessionKind {
  return findInstrument(symbol)?.group === 'Crypto' ? 'crypto' : 'forex';
}

/** Is the instrument tradeable at this instant? Crypto never closes. */
export function isMarketOpen(symbol: string, at: Date | number = Date.now()): boolean {
  if (sessionKindFor(symbol) === 'crypto') return true;

  const date = typeof at === 'number' ? new Date(at) : at;
  const day = date.getUTCDay();
  const hour = date.getUTCHours();

  if (day === 6) return false;                        // Saturday: shut all day
  if (day === 0) return hour >= WEEK_OPEN_HOUR;       // Sunday: opens in the evening
  if (day === 5) return hour < WEEK_CLOSE_HOUR;       // Friday: closes in the evening
  return true;
}
