/* ------------------------------------------------------------------ */
/*  Upstash Redis (REST)                                               */
/* ------------------------------------------------------------------ */
/**
 * Server-only. The REST token is a full-access credential — it must never reach the client,
 * so nothing in this file may be imported from a component.
 *
 * Commands are sent as a JSON array body rather than in the URL path, so values containing
 * slashes, spaces or unicode need no encoding and can't be mangled.
 */

/**
 * Two databases, deliberately.
 *
 * `app` holds the user's book — positions, history, the things that are theirs. `market`
 * holds nothing but OHLC bars published by the VPS, and is separated by blast radius rather
 * than tidiness: bars are the highest-volume and lowest-value data in the system, since every
 * device keeps its own IndexedDB copy and keeps trading if that database vanishes entirely.
 * Isolating the noisy tenant means it can never spend the quota the book depends on.
 *
 * A third database, which this file must never be pointed at, carries the EA's live trading
 * state on the VPS.
 */
export type RedisTarget = 'app' | 'market';

const ENV: Record<RedisTarget, { url: string; token: string }> = {
  app: { url: 'UPSTASH_REDIS_REST_URL', token: 'UPSTASH_REDIS_REST_TOKEN' },
  market: { url: 'UPSTASH_REDIS_REST_URL', token: 'UPSTASH_REDIS_REST_TOKEN' },
};

export class RedisUnavailableError extends Error {
  constructor(message: string) {
    super(`redis: ${message}`);
    this.name = 'RedisUnavailableError';
  }
}

function config(target: RedisTarget): { url: string; token: string } {
  const names = ENV[target];
  const url = process.env[names.url]?.trim().replace(/\/+$/, '');
  const token = process.env[names.token]?.trim();

  if (!url || !token) {
    throw new RedisUnavailableError(`${target} credentials not configured (${names.url})`);
  }
  return { url, token };
}

/**
 * A dropped connection is usually a blip, not an outage.
 *
 * These calls sit in front of reading your positions, so failing the whole request the first
 * time a packet goes missing is far too brittle — it surfaces as an empty account. Two quick
 * retries cover the overwhelming majority of transient faults while still failing fast enough
 * that a genuine outage is not disguised.
 */
const ATTEMPTS = 3;
const RETRY_BASE_MS = 150;
const TIMEOUT_MS = 8000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function command<T>(args: (string | number)[], target: RedisTarget = 'app'): Promise<T> {
  const { url, token } = config(target);
  const body = JSON.stringify(args.map(String));

  let lastError = 'network error';

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let res: Response;

    try {
      // Without this a stalled connection hangs until the platform's own timeout, which is far
      // longer than anything a page should wait on.
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body,
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'network error';
      if (attempt < ATTEMPTS) {
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      throw new RedisUnavailableError(lastError);
    }

    // 5xx is the server having a moment; 4xx is us, and retrying won't help.
    if (!res.ok) {
      lastError = `HTTP ${res.status}`;
      if (res.status >= 500 && attempt < ATTEMPTS) {
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
        continue;
      }
      throw new RedisUnavailableError(lastError);
    }

    const payload = (await res.json()) as { result?: T; error?: string };
    if (payload.error) throw new RedisUnavailableError(payload.error);

    return payload.result as T;
  }

  throw new RedisUnavailableError(lastError);
}

/* ------------------------------------------------------------------ */
/*  Typed helpers                                                      */
/* ------------------------------------------------------------------ */

export async function redisGet<T>(key: string, target: RedisTarget = 'app'): Promise<T | null> {
  const raw = await command<string | null>(['GET', key], target);
  if (raw === null || raw === undefined) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

/**
 * Many keys in one command.
 *
 * This is what keeps the market database inside a free tier: a symbol's whole 25-day window
 * is twenty-five keys, and fetching them one at a time would turn every cold start into
 * twenty-five commands per symbol. MGET makes it one.
 *
 * Positions line up with `keys`; a missing key comes back as null rather than being skipped,
 * so the caller can tell "no bars that day" from "shifted by one".
 */
export async function redisMGet<T>(
  keys: string[],
  target: RedisTarget = 'app'
): Promise<(T | null)[]> {
  if (keys.length === 0) return [];

  const raw = await command<(string | null)[]>(['MGET', ...keys], target);

  return (raw ?? []).map((value) => {
    if (value === null || value === undefined) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  });
}

/**
 * Many keys in one command, left as text.
 *
 * The bar keys hold CSV, and the route that serves them forwards it to the device
 * unchanged. Parsing it here only to serialise it straight back would put a megabyte
 * through `JSON.parse` and `JSON.stringify` inside a serverless function for no purpose
 * whatever — the device is the only thing that ever needs these as numbers.
 */
export async function redisMGetText(
  keys: string[],
  target: RedisTarget = 'app'
): Promise<(string | null)[]> {
  if (keys.length === 0) return [];

  const raw = await command<(string | null)[]>(['MGET', ...keys], target);
  return (raw ?? []).map((value) => (typeof value === 'string' ? value : null));
}

/**
 * Read a key and push its expiry out, in one command.
 *
 * This is what makes an idle-account cleanup free. Books expire on a timer, so a device that
 * only ever *reads* — someone watching an account they are not trading — would have it deleted
 * out from under them while they were using it. `GETEX` re-arms the clock as part of the read
 * rather than costing a second round trip, so "still in use" and "still wanted" are the same
 * fact and nothing has to track them separately.
 */
export async function redisGetEx<T>(
  key: string,
  ttlSeconds: number,
  target: RedisTarget = 'app'
): Promise<T | null> {
  const raw = await command<string | null>(['GETEX', key, 'EX', ttlSeconds], target);
  if (raw === null || raw === undefined) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

export async function redisSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  const payload = typeof value === 'string' ? value : JSON.stringify(value);
  if (ttlSeconds && ttlSeconds > 0) {
    await command(['SET', key, payload, 'EX', ttlSeconds]);
  } else {
    await command(['SET', key, payload]);
  }
}

export async function redisDelete(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await command(['DEL', ...keys]);
}

