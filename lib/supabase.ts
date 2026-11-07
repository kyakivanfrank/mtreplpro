/* ------------------------------------------------------------------ */
/*  Supabase (REST)                                                    */
/* ------------------------------------------------------------------ */
/**
 * Server-only: nothing in this file may be imported from a component.
 *
 * One Supabase project holds everything the app keeps off the device. Its layout lives in the
 * seeder's `supabase/schema.sql`:
 *
 *   candles, feed   market data, written by the seeder every minute
 *   books           each account's mirrored trading book
 *
 * Two keys, by least privilege:
 *
 *   publishable   SUPABASE_PUBLISHABLE_KEY  reads market data and nothing else. The database's
 *                 row-level security is what enforces that, not this file, so it is safe in a
 *                 committed env file.
 *   secret        SUPABASE_SECRET_KEY       full access. Only /api/book needs it. Never commit it
 *                 to a public repository: set it in .env.local and on the host.
 *
 * The browser never talks to Supabase. Every read goes through this app's own routes, which is
 * what lets one cached answer serve every device at once.
 */

export type SupabaseKey = 'publishable' | 'secret';

export class StoreUnavailableError extends Error {
  constructor(message: string) {
    super(`supabase: ${message}`);
    this.name = 'StoreUnavailableError';
  }
}

function config(key: SupabaseKey): { url: string; apiKey: string } {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  // The secret key can read market data too, so a server that only has that one still works.
  const apiKey = key === 'secret' ? secret : process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || secret;

  if (!url || !apiKey) {
    const name = key === 'secret' ? 'SUPABASE_SECRET_KEY' : 'SUPABASE_PUBLISHABLE_KEY';
    throw new StoreUnavailableError(`not configured (SUPABASE_URL / ${name})`);
  }
  return { url, apiKey };
}

/**
 * A dropped connection is usually a blip, not an outage. Two quick retries cover nearly every
 * transient fault while still failing fast enough that a real outage is not disguised.
 */
const ATTEMPTS = 3;
const RETRY_BASE_MS = 150;
const TIMEOUT_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function send(path: string, init: RequestInit, key: SupabaseKey): Promise<Response> {
  const { url, apiKey } = config(key);
  let lastError = 'network error';

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${url}/rest/v1/${path}`, {
        ...init,
        headers: { apikey: apiKey, 'Content-Type': 'application/json', ...init.headers },
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'network error';
      if (attempt < ATTEMPTS) {
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      throw new StoreUnavailableError(lastError);
    }

    if (res.ok) return res;

    // 5xx is the server having a moment; 4xx is us, and retrying will not help.
    lastError = `HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`;
    if (res.status >= 500 && attempt < ATTEMPTS) {
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
      continue;
    }
    throw new StoreUnavailableError(lastError);
  }

  throw new StoreUnavailableError(lastError);
}

/** Call a database function. A function that returns nothing resolves to null. */
export async function rpc<T>(
  name: string,
  args: Record<string, unknown> = {},
  key: SupabaseKey = 'publishable'
): Promise<T | null> {
  const res = await send(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) }, key);
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : null;
}

/** Delete the rows of `table` matching PostgREST filters, e.g. `{ account: 'eq.123' }`. */
export async function remove(
  table: string,
  filters: Record<string, string>,
  key: SupabaseKey = 'secret'
): Promise<void> {
  await send(`${table}?${new URLSearchParams(filters)}`, { method: 'DELETE' }, key);
}

/* ------------------------------------------------------------------ */
/*  Shared answers                                                     */
/* ------------------------------------------------------------------ */

const shared = new Map<string, { expires: number; value: Promise<unknown> }>();

/**
 * One database read per `key` for as long as `ttlMs(value)` says, however many requests ask.
 *
 * On a deployment the edge cache already does this across every device; this covers the app
 * running on a single machine (`next start` on a PC, phones on the LAN), where each device's
 * request would otherwise reach the database on its own. Requests that arrive while a read is in
 * flight share it, and a failed read is never kept.
 */
export function sharedRead<T>(
  key: string,
  load: () => Promise<T>,
  ttlMs: (value: T) => number
): Promise<T> {
  const now = Date.now();
  const hit = shared.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;

  const entry = { expires: Number.POSITIVE_INFINITY, value: load() as Promise<unknown> };
  shared.set(key, entry);
  entry.value.then(
    (value) => {
      entry.expires = Date.now() + Math.max(0, ttlMs(value as T));
    },
    () => {
      if (shared.get(key) === entry) shared.delete(key);
    }
  );
  return entry.value as Promise<T>;
}
