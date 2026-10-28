'use client';

/* ------------------------------------------------------------------ */
/*  Local database                                                     */
/* ------------------------------------------------------------------ */
/**
 * The app has no server-side database, so the device *is* the database.
 *
 * Two storage engines, one guarantee:
 *   - localStorage holds settings — small, synchronous, readable during the first render so
 *     the UI never flashes defaults before the user's own config appears.
 *   - IndexedDB holds bulk records (the minute archive, the trading book) — no practical size
 *     ceiling, structured, transactional.
 *
 * What makes it *durable* rather than merely saved is `navigator.storage.persist()`. By
 * default a browser marks origin data "best-effort" and may evict all of it — localStorage
 * included — when the device runs low on space. Requesting persistence moves the origin into
 * "persistent" mode, which is never evicted automatically: it survives reloads, restarts, and
 * an installed PWA being backgrounded for weeks. Only the user can remove it, by clearing site
 * data, uninstalling the PWA, or using the delete action in Settings.
 *
 * Installed PWAs are normally granted persistence without a prompt; in a browser tab it may be
 * granted based on engagement, or declined. `storageStatus()` reports which happened, so the
 * UI can tell the truth rather than assume.
 */

const DB_NAME = 'mt5-market';

/**
 * v1 shipped with only `bars`; v2 added the record stores; v3 added `m1`, the deep minute
 * archive every timeframe is built from.
 *
 * v4 does two things. It drops `bars`, which nothing has read since v3 rolled every timeframe
 * up from `m1`, and it adds the two stores that let the device work offline properly:
 *
 *   `books` — the trading book, arriving from localStorage. It grows without bound as deals
 *             accumulate, and localStorage caps out around 5MB, so a busy account would
 *             eventually fail to save with no way to tell the user. Here it has no ceiling.
 *   `meta`  — per symbol: the newest bar the device holds, when it last synced, and the
 *             instrument spec from the feed. The watermark is what makes a reconnect cheap:
 *             ask for the gap, not for the whole window.
 *
 * v5 is a clean break, not a migration. Everything stored before it was keyed by the old
 * slashed symbol ("EUR/USD") and priced from the REST providers — bars whose bid/ask never
 * existed, and a book keyed to instruments this app no longer names that way. Carrying any of
 * it forward would mean archives no lookup can find and positions that cannot be priced.
 *
 * So every store is dropped and recreated empty. The bars come back from the bridge on first
 * connect, which is the whole point of it being a cache.
 *
 * `bars` replaced `m1`, holding one entry per (symbol, timeframe) rather than one minute
 * archive per symbol that every other timeframe was rolled up from — the terminal's own bars
 * per timeframe, downloaded on demand.
 *
 * v6 brings `m1` back, for a different reason than it left. The charts no longer read the feed
 * at all: the bridge downloads a deep minute archive per symbol, and playback walks it as if it
 * were live, so the app can trade M1 without bars being re-synced underneath it. One archive
 * per symbol, every timeframe bucketed from it. See lib/market/archive.ts.
 *
 * `bars` goes with it. Storing the broker's own bars per timeframe only made sense while the
 * terminal was the thing being charted; now that every timeframe is bucketed from the minutes,
 * a second set of pre-bucketed bars would be a second, disagreeing source of truth.
 */
const DB_VERSION = 6;

export const STORES = ['books', 'meta', 'm1'] as const;
export type StoreName = (typeof STORES)[number];

/** Prefix for every localStorage key the app owns, so deletion never touches anything else. */
export const LOCAL_PREFIX = 'mt5:';

/** Used when IndexedDB is unavailable (SSR, private mode) so callers never have to branch. */
const memory = new Map<string, unknown>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      // Only what this version no longer knows about. Earlier upgrades dropped every store on
      // the way through, which was defensible when the data itself was wrong — but `books`
      // holds the user's trading history, and there is nothing wrong with it, so a schema
      // change must not take it.
      for (const name of Array.from(db.objectStoreNames)) {
        if (!(STORES as readonly string[]).includes(name)) db.deleteObjectStore(name);
      }

      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

function memoryKey(store: StoreName, key: string): string {
  return `${store}::${key}`;
}

export async function dbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return memory.get(memoryKey(store, key)) as T | undefined;

  return new Promise((resolve) => {
    try {
      const request = db.transaction(store, 'readonly').objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function dbSet(store: StoreName, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory.set(memoryKey(store, key), value);
    return;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}



/**
 * Drop one record.
 *
 * Needed because the archive is a cache with a budget: eighty days of minute bars is 2.8MB
 * per symbol, so a watchlist that has wandered over thirty instruments is carrying ~95MB of
 * history for charts nobody is looking at. Evicting the least recently opened costs one
 * refetch if it is ever opened again.
 */
export async function dbDelete(store: StoreName, key: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory.delete(memoryKey(store, key));
    return;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Every key in a store. Used to find eviction candidates without loading their values. */
export async function dbKeys(store: StoreName): Promise<string[]> {
  const db = await openDb();
  if (!db) {
    const prefix = `${store}::`;
    return [...memory.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  }

  return new Promise((resolve) => {
    try {
      const request = db.transaction(store, 'readonly').objectStore(store).getAllKeys();
      request.onsuccess = () => resolve((request.result as IDBValidKey[]).map(String));
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function dbClear(store: StoreName): Promise<void> {
  const db = await openDb();
  if (!db) {
    [...memory.keys()].filter((k) => k.startsWith(`${store}::`)).forEach((k) => memory.delete(k));
    return;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Durability                                                         */
/* ------------------------------------------------------------------ */

export interface StorageStatus {
  /** The browser exposes the Storage API at all. */
  supported: boolean;
  /** Origin data is exempt from automatic eviction. */
  persistent: boolean;
  /** Bytes currently used, if the browser will say. */
  usage: number;
  /** Bytes available to this origin, if the browser will say. */
  quota: number;
}

/**
 * Ask the browser to make this origin's storage permanent. Safe to call repeatedly — once
 * granted it returns immediately, and a decline is not an error, just best-effort storage.
 */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;

  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageStatus(): Promise<StorageStatus> {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return { supported: false, persistent: false, usage: 0, quota: 0 };
  }

  try {
    const persistent = (await navigator.storage.persisted?.()) ?? false;
    const estimate = (await navigator.storage.estimate?.()) ?? {};

    return {
      supported: true,
      persistent,
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
    };
  } catch {
    return { supported: true, persistent: false, usage: 0, quota: 0 };
  }
}

/**
 * Remove everything the app has stored on this device — the only path by which saved data
 * disappears short of uninstalling. Deliberately scoped: it clears this app's IndexedDB stores
 * and only localStorage keys under our own prefix.
 *
 * `mt5:device` used to be exempt here: the browser's identity was what an account was bound
 * to, and deleting it locked the rightful owner out of their own credentials. Nothing binds to
 * a device any more, so the exemption is gone and the stale id is swept up with everything
 * else. Signing out is not a side effect of this — the session is a cookie, not a setting.
 */
export async function deleteAllLocalData(): Promise<void> {
  await Promise.all(STORES.map((store) => dbClear(store)));

  if (typeof localStorage !== 'undefined') {
    try {
      Object.keys(localStorage)
        .filter((key) => key.startsWith(LOCAL_PREFIX))
        .forEach((key) => localStorage.removeItem(key));
    } catch {
      /* storage disabled — nothing to clear */
    }
  }

  memory.clear();
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
