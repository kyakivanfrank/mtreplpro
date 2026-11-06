import { NextResponse } from 'next/server';
import { redisMGet } from '@/lib/redis';

/**
 * Everything a device needs to know before it asks for a single candle.
 *
 * Three things in one reply, because a device needs all three on every pass and splitting
 * them would only mean three round trips to learn the same thing:
 *
 *   symbols    the broker's own numbers — digits, point size, contract size, spread,
 *              volume steps — so an order ticket is sized against what the account
 *              actually trades rather than a built-in guess.
 *
 *   days       how deep the window is. The single source of truth for it: the publisher
 *              enforces exactly this many calendar days per symbol and the app sizes
 *              itself from this rather than from a setting of its own. There used to be a
 *              settings row for it, which could only ever disagree with the publisher — a
 *              device asking for 150 days of a 25-day feed was asking for something nobody
 *              was going to send it.
 *
 *   manifest   `{symbol: {"2026-08-22": 1440}}` — the bar count the store holds for every
 *              published day. This is the part that makes the feed cheap. A device compares
 *              it against what its own archive holds and asks only for the days whose count
 *              actually moved, so a closed market costs it nothing at all rather than
 *              re-downloading two identical days every half hour.
 *
 *   live       `{url}` of the seeder's live WebSocket feed, from `MT5_LIVE_URL` in this app's
 *              environment, or null. Never from the database: the live feed keeps entirely
 *              out of Redis. Without it, a page opened over plain http dials the seeder on its
 *              own host (see lib/market/live.ts). The device tries the feed first and falls
 *              back to the database on its own.
 *
 * Both keys are fetched in a single MGET, so this is one Redis command.
 */

export const MARKET_META_KEY = 'mt5:meta';
export const MARKET_MANIFEST_KEY = 'mt5:manifest';

interface PublishedMeta {
  symbols: unknown[];
  days: number;
  updated: number;
}

type Manifest = Record<string, Record<string, number>>;

/** Where the live feed is, from the environment. */
function liveEndpoint(): { url: string } | null {
  const fixed = process.env.MT5_LIVE_URL?.trim();
  return fixed ? { url: fixed } : null;
}

export async function GET() {
  try {
    const [meta, manifest] = await redisMGet<PublishedMeta | Manifest>(
      [MARKET_META_KEY, MARKET_MANIFEST_KEY],
      'market'
    );

    if (!meta) {
      // The database is reachable but empty: the VPS has not published yet. Distinct from a
      // failure, and the app says so differently — this one resolves on its own.
      return NextResponse.json(
        {
          error: 'No market data has been published yet.',
          symbols: [],
          days: 0,
          manifest: {},
          live: liveEndpoint(),
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    return NextResponse.json(
      {
        ...(meta as PublishedMeta),
        manifest: (manifest as Manifest) ?? {},
        live: liveEndpoint(),
      },
      {
        headers: {
          /*
           * Cached at the edge so every device on a deployment shares one lookup, but only
           * for a couple of minutes — the manifest travels in here, and it is what tells a
           * device new candles exist. The specs beside it change about never; the manifest
           * is the reason this is 120 seconds and not an hour.
           */
          'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600',
        },
      }
    );
  } catch (err) {
    console.error('[mt5] meta failed:', err);
    return NextResponse.json(
      {
        error: 'The market data store is unreachable.',
        symbols: [],
        days: 0,
        manifest: {},
        live: liveEndpoint(),
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
