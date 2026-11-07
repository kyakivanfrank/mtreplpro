import { NextResponse } from 'next/server';
import { rpc, sharedRead } from '@/lib/supabase';

/**
 * Everything a device needs to know before it asks for a single candle, in one database call
 * (`m1_meta`, see the seeder's supabase/schema.sql):
 *
 *   symbols    the broker's own numbers (digits, point size, contract size, spread, volume
 *              steps), so an order ticket is sized against what the account actually trades.
 *
 *   candles    how deep the window is, in M1 candles. The single source of truth for it: the
 *              seeder keeps exactly this many per symbol and the app sizes itself from this.
 *
 *   manifest   `{symbol: {"2026-08-22": 1440}}`, the bar count the database holds for every
 *              day. A device compares it with what its own archive holds and downloads only the
 *              days it is short of, so a closed market costs it nothing.
 *
 *   through    every minute that ended at or before this unix second has been written. The
 *              seeder advances it once a minute, so `live` (moved within the last three
 *              minutes) says whether candles are still arriving.
 */

export const dynamic = 'force-dynamic';

/** Within this long of now, the seeder is publishing. */
const LIVE_SECONDS = 180;

interface PublishedMeta {
  symbols: unknown[];
  candles: number;
  through: number;
  updated: number;
  manifest: Record<string, Record<string, number>>;
}

function failure(error: string) {
  return NextResponse.json(
    { error, symbols: [], candles: 0, days: 0, through: 0, live: false, manifest: {} },
    { status: 503, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function GET() {
  let meta: PublishedMeta | null;
  try {
    meta = await sharedRead(
      'meta',
      () => rpc<PublishedMeta>('m1_meta'),
      () => 15_000
    );
  } catch (err) {
    console.error('[mt5] meta failed:', err);
    return failure('The market database is unreachable.');
  }

  // Reachable but empty: the seeder has never run against this database. Resolves on its own.
  if (!meta) return failure('No market data has been published yet.');

  const now = Math.floor(Date.now() / 1000);
  return NextResponse.json(
    {
      ...meta,
      days: Math.round(meta.candles / 1_440),
      live: meta.through >= now - LIVE_SECONDS,
      time: now,
    },
    {
      headers: {
        // Shared at the edge, briefly: the manifest in here is what tells a device that a day it
        // holds has grown, and the minute feed already carries the newest bars between passes.
        'Cache-Control': 'public, max-age=0, s-maxage=30, stale-while-revalidate=60',
      },
    }
  );
}
