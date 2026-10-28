import { NextRequest, NextResponse } from 'next/server';
import { redisDelete, redisGetEx, redisSet } from '@/lib/redis';
import { readSession, SESSION_COOKIE } from '@/lib/auth/session';
import { normalizeAccountKey } from '@/lib/accountKey';

/**
 * The account book, mirrored server-side and keyed to the account number.
 *
 * This is a convenience layer, never the source of truth: the device's own copy is
 * authoritative and the app trades perfectly well with this endpoint unreachable. What it buys
 * is continuity — the same account number on a reinstalled PWA finds its positions and history
 * waiting instead of an empty account.
 *
 * ── Why the account number and not the session ───────────────────────
 *
 * It used to key on the signed-in handle, and there is only one of those: the credential is
 * shared on purpose, and the cookie is an HMAC over an expiry with no identity in it at all.
 * So every device in the world wrote to `mt5:book:usergn` and the last writer won — which is
 * why people in different places watched each other's trades appear.
 *
 * The account number is the thing that actually names an account, so it names the key. Note
 * what that does and does not buy: it *separates* books, it does not *protect* them. Anyone
 * signed in who types someone else's number reads their book. The session check below is only
 * a gate on the endpoint existing at all, not on which account may be asked for.
 *
 * ── Cleanup ──────────────────────────────────────────────────────────
 *
 * Every key carries a TTL, re-armed on every read and every write. There is no registry of
 * known accounts, no scheduled job and no scan: a book that nobody has opened in a week is
 * removed by Redis itself. An index would be a second thing to keep in sync — and would need
 * pruning of its own, which is the problem again one level up.
 */

/** A week of not being opened, and the mirror is dropped. The device's own copy is untouched. */
const RETENTION_SECONDS = 7 * 24 * 60 * 60;

/** Books are small (positions, orders, closed deals) but a runaway history shouldn't persist. */
const MAX_BYTES = 512 * 1024;

function bookKey(account: string): string {
  return `mt5:book:acct:${account}`;
}

/** Signed in at all? Not *which* account — see the note above. */
function authenticated(request: NextRequest): boolean {
  return readSession(request.cookies.get(SESSION_COOKIE)?.value) !== null;
}

const NO_ACCOUNT = NextResponse.json({ error: 'account required' }, { status: 400 });

export async function GET(request: NextRequest) {
  try {
    if (!authenticated(request)) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const account = normalizeAccountKey(request.nextUrl.searchParams.get('account'));
    if (!account) return NO_ACCOUNT;

    // Reading is also using: the expiry is pushed out here, so an account being watched rather
    // than traded does not quietly age out from under its owner.
    const books = await redisGetEx<unknown>(bookKey(account), RETENTION_SECONDS);
    return NextResponse.json({ books: books ?? null });
  } catch (err) {
    // The store being down must not look like "you have no positions" — say so plainly and
    // let the client keep trusting the copy on the device.
    console.error('Book read error:', err);
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
}

async function save(request: NextRequest) {
  try {
    if (!authenticated(request)) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const raw = await request.text();
    if (raw.length > MAX_BYTES) {
      return NextResponse.json({ error: 'too large' }, { status: 413 });
    }

    let payload: { books?: unknown; account?: unknown };
    try {
      payload = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }

    // In the body rather than a header or the query string, because the unload path uses
    // `sendBeacon`, which can set neither.
    const account = normalizeAccountKey(
      typeof payload.account === 'string' ? payload.account : null
    );
    if (!account) return NO_ACCOUNT;

    if (!payload.books || typeof payload.books !== 'object') {
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }

    await redisSet(bookKey(account), payload.books, RETENTION_SECONDS);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Book write error:', err);
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
}

/**
 * Drop the server's copy.
 *
 * Wiping the device alone is not enough: the next launch would pull this book straight back
 * and the user would watch the account they just deleted reappear. "Delete local data" calls
 * this first so both copies go together.
 */
export async function DELETE(request: NextRequest) {
  try {
    if (!authenticated(request)) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
    }

    const account = normalizeAccountKey(request.nextUrl.searchParams.get('account'));
    if (!account) return NO_ACCOUNT;

    await redisDelete(bookKey(account));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Book delete error:', err);
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
}

export const PUT = save;

/** sendBeacon can only POST, and that is the path used when the app is backgrounded. */
export const POST = save;
