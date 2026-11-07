import { NextRequest, NextResponse } from 'next/server';
import { rpc } from '@/lib/supabase';

/**
 * One symbol's minute candles on the days asked for, as CSV, oldest first:
 *
 *   t,o,h,l,c,v          1787443200,4012.340,4013.100,4011.900,4012.500,137
 *
 *   ?symbol=XAUUSD&days=2026-11-05:1440,2026-11-06:1385
 *
 * Each day carries the bar count the device expects for it, from the manifest in
 * `/api/mt5/meta`. That count is what makes the answer cacheable for a long time: the database
 * only ever adds bars to a day (and trims the oldest day of the window), so the same day with the
 * same count is the same bytes. The URL names its content, every device filling the same days
 * shares one cached copy at the edge, and a day that grows simply asks under a new URL.
 *
 * A count is a promise the route checks before caching: if the database answers with fewer bars
 * than a day claims (a request racing a write), the reply is cached for seconds, not weeks. A
 * day given without a count (`days=2026-11-05`) is served and cached briefly.
 *
 * The CSV comes out of the database already formatted (`m1_csv`) and is passed on as it is.
 */

export const dynamic = 'force-dynamic';

/** Symbols are canonical and short; anything else is not something the seeder published. */
const SYMBOL_PATTERN = /^[A-Z0-9]{3,12}$/;

const DAY_PATTERN = /^(\d{4}-\d{2}-\d{2})(?::(\d{1,5}))?$/;

/** More days than any window the seeder publishes. A guard on the URL, not a real limit. */
const MAX_DAYS = 120;

const DAY_SECONDS = 86_400;

/** The URL names its content: cache it for a month. */
const CACHE_LONG = 'public, max-age=0, s-maxage=2592000';
/** Something may still change under this URL. */
const CACHE_SHORT = 'public, max-age=0, s-maxage=15';

function csv(body: string, days: number, bars: number, cache: string): NextResponse {
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': cache,
      // Cheap, and worth a lot when a chart looks wrong: did the database answer with nothing,
      // or did the device drop it?
      'X-Days': String(days),
      'X-Bars': String(bars),
    },
  });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = (params.get('symbol') ?? '').trim().toUpperCase();

  if (!SYMBOL_PATTERN.test(symbol)) {
    return NextResponse.json({ error: 'bad symbol' }, { status: 400 });
  }

  /** Day number (unix seconds / 86400) -> the bar count the caller expects, or null. */
  const wanted = new Map<number, number | null>();
  for (const entry of (params.get('days') ?? '').split(',')) {
    const item = entry.trim();
    if (!item) continue;
    const match = DAY_PATTERN.exec(item);
    const day = match ? Date.parse(`${match[1]}T00:00:00Z`) / 1000 / DAY_SECONDS : NaN;
    if (!match || !Number.isInteger(day)) {
      return NextResponse.json({ error: 'bad day' }, { status: 400 });
    }
    wanted.set(day, match[2] ? Number(match[2]) : null);
  }

  if (wanted.size === 0) {
    return NextResponse.json({ error: 'days required' }, { status: 400 });
  }
  if (wanted.size > MAX_DAYS) {
    return NextResponse.json({ error: 'too many days' }, { status: 400 });
  }

  let body: string;
  try {
    body = (await rpc<string>('m1_csv', { p_symbol: symbol, p_days: [...wanted.keys()] })) ?? '';
  } catch (err) {
    console.error(`[mt5] bars for ${symbol} failed:`, err);
    return NextResponse.json(
      { error: 'The market database is unreachable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  // Count what came back per day, from each line's leading timestamp.
  const held = new Map<number, number>();
  let bars = 0;
  if (body) {
    for (const line of body.split('\n')) {
      const day = Math.floor(parseInt(line, 10) / DAY_SECONDS);
      held.set(day, (held.get(day) ?? 0) + 1);
      bars++;
    }
  }

  let complete = true;
  for (const [day, count] of wanted) {
    if (count === null || (held.get(day) ?? 0) < count) complete = false;
  }

  return csv(body, wanted.size, bars, complete ? CACHE_LONG : CACHE_SHORT);
}
