import { NextRequest, NextResponse } from 'next/server';
import { redisGet, redisMGetText } from '@/lib/redis';

/**
 * One symbol's minute candles, as CSV.
 *
 *   t,o,h,l,c,v          1787443200,4012.340,4013.100,4011.900,4012.500,137
 *
 * The store keeps a key per symbol per day, each already CSV, and this route concatenates
 * the days asked for. It never parses them: the text goes from Redis to the device
 * untouched, so a megabyte of candles does not get run through `JSON.parse` and
 * `JSON.stringify` inside a serverless function on its way to a client that was only ever
 * going to turn it into numbers itself.
 *
 * Two shapes:
 *
 *   ?symbol=XAUUSD&days=2026-08-21,2026-08-22   exactly those days — what the app asks for
 *   ?symbol=XAUUSD                              the whole published window
 *
 * The first is the one that matters. A device holds the manifest from `/api/mt5/meta`, so
 * it knows which days' bar counts have actually moved since it last looked, and asks for
 * those alone. Over a closed market that list is empty and it makes no request at all.
 * The second exists so a window can be pulled in one go from a browser when something needs
 * looking at, and as the path a first-ever download takes.
 *
 * Cost is one Redis command for the named-days form — a single MGET however many days are
 * listed. Without it a cold start would be twenty-five commands per symbol, which is how a
 * free tier gets spent.
 */

const MANIFEST_KEY = 'mt5:manifest';

/** `{symbol: {"2026-08-22": barCount}}` — what the publisher says is in the store. */
type Manifest = Record<string, Record<string, number>>;

/** Symbols are canonical and short; anything else is not something we published. */
const SYMBOL_PATTERN = /^[A-Z0-9]{3,12}$/;

/** Day keys are ISO dates and nothing else — this is also what keeps them out of key space. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** More days than any window we publish. A guard on the URL, not a real limit. */
const MAX_DAYS = 120;

function csv(body: string, days: number, cache: string): NextResponse {
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': cache,
      // Cheap to produce and worth a great deal when a chart looks wrong: you can see at a
      // glance whether the store answered with nothing or the device dropped it.
      'X-Days': String(days),
      'X-Bars': String(body ? body.split('\n').length : 0),
    },
  });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const symbol = (params.get('symbol') ?? '').trim().toUpperCase();

  if (!SYMBOL_PATTERN.test(symbol)) {
    return NextResponse.json({ error: 'bad symbol' }, { status: 400 });
  }

  const requested = (params.get('days') ?? '')
    .split(',')
    .map((day) => day.trim())
    .filter(Boolean);

  if (requested.some((day) => !DAY_PATTERN.test(day))) {
    return NextResponse.json({ error: 'bad day' }, { status: 400 });
  }
  if (requested.length > MAX_DAYS) {
    return NextResponse.json({ error: 'too many days' }, { status: 400 });
  }

  try {
    let days = requested;

    if (days.length === 0) {
      // No day list: serve the whole published window. Costs one extra command to learn
      // which days exist, which is why the app never takes this path after its first fill.
      const manifest = (await redisGet<Manifest>(MANIFEST_KEY, 'market')) ?? {};
      days = Object.keys(manifest[symbol] ?? {});
    }

    if (days.length === 0) {
      // Nothing published for this symbol yet — it is still waiting its turn in the
      // publisher's backfill queue, or the broker does not offer it. Not an error: the app
      // works this out from the manifest and says so per symbol.
      return csv('', 0, 'public, s-maxage=60');
    }

    // ISO dates sort correctly as plain strings, and each day's own bars are already
    // ascending, so concatenating sorted days yields one globally ascending series with no
    // sorting anywhere in this process.
    days.sort();

    const chunks = await redisMGetText(
      days.map((day) => `mt5:m1:${symbol}:${day}`),
      'market'
    );

    // A key the manifest lists but the store no longer holds is dropped rather than
    // faulted: the two are written separately, so a request can land between them. The
    // device notices the day is still short and asks again on its next pass.
    const body = chunks.filter((chunk): chunk is string => !!chunk).join('\n');

    return csv(
      body,
      days.length,
      /*
       * Two minutes at the edge. Most of what is asked for here is closed days that will
       * never change again, but the newest day in the list is still forming, and the URL
       * names both together. Short caching is what keeps Redis reads from scaling with the
       * number of devices without ever serving a stale tail.
       */
      'public, s-maxage=120, stale-while-revalidate=600'
    );
  } catch (err) {
    console.error(`[mt5] bars for ${symbol} failed:`, err);
    return NextResponse.json(
      { error: 'The market data store is unreachable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
