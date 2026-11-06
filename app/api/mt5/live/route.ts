import { NextRequest, NextResponse } from 'next/server';

/**
 * The seeder's live feed, relayed through this app's own server.
 *
 * A page served over https is not allowed to open a plain `ws://` connection (browsers block it
 * as mixed content), and the seeder's feed is deliberately plain: no certificate, open to
 * anyone who knows the address. A server has no such rule, so the page asks here, over its own
 * https origin, and this asks the seeder over plain HTTP on the same port the socket uses:
 *
 *   GET /api/mt5/live?op=meta                                    -> seeder /meta
 *   GET /api/mt5/live?op=history&symbol=&before=&after=&limit=   -> seeder /history
 *   GET /api/mt5/live?op=days&symbol=                            -> seeder /days
 *   GET /api/mt5/live?op=latest                                  -> seeder /latest
 *
 * The seeder's address is `MT5_LIVE_URL` (`ws://host:8765` or `http://host:8765`; either works).
 * It may list several, comma-separated (`ws://home:8765,ws://vps:8765`): whichever machine is
 * running the seeder answers, and the one that last answered is asked first. Each has to be
 * reachable from wherever this app runs: a VPS's public address, or a home machine's public
 * address with the port forwarded. In development it defaults to this machine.
 *
 * Nothing here touches the database. Short edge caching lets every device on a deployment
 * share one upstream request per few seconds instead of each making its own.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const OPS = new Set(['meta', 'history', 'days', 'latest']);
const PASSED = ['symbol', 'before', 'after', 'limit'];

/** Long enough for a deep history read. */
const TIMEOUT_MS = 12_000;

function seederBases(): string[] {
  const configured = process.env.MT5_LIVE_URL?.trim();
  if (configured) {
    return configured
      .split(',')
      .map((url) => url.trim().replace(/^ws(s?):\/\//i, 'http$1://').replace(/\/+$/, ''))
      .filter(Boolean);
  }
  return process.env.NODE_ENV === 'development' ? ['http://127.0.0.1:8765'] : [];
}

/** The address that last answered, kept for as long as this server instance lives. */
let preferred: string | null = null;

async function attempt(base: string, path: string): Promise<Response> {
  const response = await fetch(`${base}${path}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${response.status}`);
  return response;
}

/**
 * The last address that answered is asked first. If it does not (or none has yet), every
 * address is asked at once and the first to answer wins, so a dead entry in the list never
 * costs a wait.
 */
async function ask(bases: string[], path: string): Promise<Response | null> {
  if (preferred && bases.includes(preferred)) {
    try {
      return await attempt(preferred, path);
    } catch {
      preferred = null;
    }
  }
  try {
    return await Promise.any(
      bases.map(async (base) => {
        const response = await attempt(base, path);
        preferred = base;
        return response;
      })
    );
  } catch {
    return null;
  }
}

/** `latest` changes every minute; the rest are fine a little stale. */
function cacheFor(op: string): string {
  return op === 'latest' ? 'public, s-maxage=5' : 'public, s-maxage=20';
}

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: NextRequest) {
  const op = request.nextUrl.searchParams.get('op') ?? '';
  if (!OPS.has(op)) return fail(400, 'Unknown live feed request.');

  const bases = seederBases();
  if (bases.length === 0) return fail(503, 'No live feed is configured (MT5_LIVE_URL).');

  const query = new URLSearchParams();
  for (const key of PASSED) {
    const value = request.nextUrl.searchParams.get(key);
    if (value !== null) query.set(key, value);
  }

  const upstream = await ask(bases, `/${op}?${query}`);
  if (!upstream) return fail(502, 'The live feed is unreachable from the app server.');
  try {
    return new NextResponse(await upstream.text(), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheFor(op) },
    });
  } catch {
    return fail(502, 'The live feed stopped answering mid-reply.');
  }
}
