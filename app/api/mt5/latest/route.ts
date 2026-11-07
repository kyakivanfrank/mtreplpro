import { NextResponse } from 'next/server';
import { rpc, sharedRead } from '@/lib/supabase';

/**
 * The newest candles of every symbol: what every open device asks for once a minute.
 *
 *   {"through": 1787443260, "live": true, "time": 1787443267,
 *    "bars": {"XAUUSD": "t,o,h,l,c,v\n...", ...}}
 *
 * The last ten closed bars per symbol (`m1_latest`), so a device that missed a few polls still
 * joins up without downloading anything else, plus `through`: every minute that ended at or
 * before it has been written.
 *
 * ── One read a minute, however many devices ─────────────────────────
 *
 * Every device asks the same URL, and the answer is cached at the edge until just after the next
 * minute is due. So the database is read about once a minute per region whether one phone is open
 * or a thousand are, and nothing here is metered per device: no realtime connections, no message
 * quota. The cache lifetime follows the feed:
 *
 *   the minute is in        until the next one should be (boundary + a few seconds)
 *   the seeder is late      2 s, so the retry a device makes a few seconds later sees it
 *   the seeder is off       30 s: nothing is going to change
 */

export const dynamic = 'force-dynamic';

/** Bars per symbol in each answer. */
const BARS = 10;

/** Within this long of now, the seeder is publishing. */
const LIVE_SECONDS = 180;

/** The seeder counts a quiet minute closed this long after it ends, then writes it. */
const CLOSE_GRACE_SECONDS = 5;

/** How long after a boundary the next answer is expected to hold that minute. */
const NEXT_AT_SECONDS = 6;

interface Latest {
  through: number;
  bars: Record<string, string>;
}

/** Seconds this answer stays good for. */
function lifetime(through: number, now: number): number {
  if (through < now - LIVE_SECONDS) return 30;
  const expected = Math.floor((now - CLOSE_GRACE_SECONDS) / 60) * 60;
  if (through < expected) return 2;
  const next = expected + 60 + NEXT_AT_SECONDS;
  return Math.min(60, Math.max(1, next - now));
}

export async function GET() {
  let latest: Latest | null;
  try {
    latest = await sharedRead(
      'latest',
      () => rpc<Latest>('m1_latest', { p_bars: BARS }),
      (value) => lifetime(value?.through ?? 0, Math.floor(Date.now() / 1000)) * 1000
    );
  } catch (err) {
    console.error('[mt5] latest failed:', err);
    return NextResponse.json(
      { error: 'The market database is unreachable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const through = latest?.through ?? 0;

  return NextResponse.json(
    {
      through,
      live: through >= now - LIVE_SECONDS,
      time: now,
      bars: latest?.bars ?? {},
    },
    { headers: { 'Cache-Control': `public, max-age=0, s-maxage=${lifetime(through, now)}` } }
  );
}
