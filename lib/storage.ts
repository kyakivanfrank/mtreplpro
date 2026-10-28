'use client';

import { useCallback, useEffect, useState } from 'react';
import { LOCAL_PREFIX } from './db';

/* ------------------------------------------------------------------ */
/*  Persistent app state                                               */
/* ------------------------------------------------------------------ */
/**
 * Everything the user configures lives here and survives reloads, app restarts and being
 * closed — it is cleared only by uninstalling the PWA, clearing site data, or the user
 * changing the setting again.
 *
 * localStorage is right for *settings*: small, synchronous, and readable during the first
 * render so the watchlist paints with the user's own symbols instead of flashing the defaults.
 * Downloaded bars deliberately do NOT live here — a single instrument's M1 history is roughly
 * 400KB and localStorage caps out around 5MB, so bars stay in IndexedDB (see lib/db.ts),
 * which has no practical ceiling and keeps them across sessions just the same.
 */

/** Shared with lib/db.ts so "delete local data" and these writes can never drift apart. */
const PREFIX = LOCAL_PREFIX;

/**
 * Bump only on an incompatible shape change; it discards previously stored values.
 *
 * v2: the market feed moved from REST providers to the MT5 bridge, and with it three things
 * that made every v1 value untrustworthy. Stored quotes were synthesized — bid/ask invented
 * from a last price and a constant spread — so restoring them would put fabricated prices on
 * the board next to real ones. Stored books carried the old 57.29 opening balance. And the
 * book shape itself changed: history now lives in IndexedDB, so a v1 book read back into the
 * hot slice would duplicate every deal.
 *
 * v3: symbols became canonical. Every stored watchlist, chart selection and book referred to
 * instruments as "EUR/USD"; the feed names them "EURUSD", and nothing resolves across that
 * gap — a restored v2 watchlist would be six rows that never receive a price.
 *
 * Discarding is the honest option here. Everything lost is either a preference the user can
 * set again in a tap or data the feed re-sends on connect.
 */
const VERSION = 3;

export const STORAGE_KEYS = {
  watchlist: 'watchlist',
  chartSymbol: 'chart.symbol',
  chartTimeframe: 'chart.timeframe',
  /** Superseded by `books`; still read once to migrate an existing device. */
  positions: 'positions',
  balance: 'account.balance',
  /**
   * Superseded by the IndexedDB `books` store; read once to migrate, then cleared.
   *
   * A book grows without bound as deals accumulate, and this is a ~5MB store — so a busy
   * account eventually hit a silent write failure with no way to tell the user their fills
   * had stopped saving. IndexedDB has no such ceiling.
   */
  books: 'trading.books',
  /** Last volume the user traded, so the ticket reopens on it. */
  lot: 'trade.lot',
} as const;

/**
 * A key that belongs to one account rather than to the device.
 *
 * The dividing line is ownership, not tidiness. Anything the *account* owns — its book, its
 * watchlist, the instrument and timeframe it was left on, the lot size it last traded — moves
 * with the account number, so switching numbers swaps them instead of merging them, and
 * switching back finds them as they were.
 *
 * Anything the *market* owns stays where it is and is deliberately not scoped: the candle
 * archive, the quote cache and the playback clock describe the tape, not the trader. Copying
 * 25 days of minute bars per account number would be the one genuinely expensive mistake
 * available here, and two accounts reading the same market at different times would be worse
 * than untidy — it would let one predict the other.
 *
 * The account's own config is unscoped for a plainer reason: it is where the number is kept.
 */
export function scopedKey(key: string, account: string): string {
  return `${key}.${account}`;
}

/**
 * Where one account's book lives on this device.
 *
 * `STORAGE_KEYS.books` is now also the pre-split key, read once at startup to migrate whatever
 * a device already held into whichever account it was holding it as.
 */
export function booksKey(account: string): string {
  return scopedKey(STORAGE_KEYS.books, account);
}

interface Envelope<T> {
  v: number;
  value: T;
}

export function readSetting<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;

  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;

    const parsed = JSON.parse(raw) as Envelope<T>;
    if (parsed?.v !== VERSION) return fallback;

    return parsed.value;
  } catch {
    // Corrupt or unreadable (private mode, quota): fall back rather than break the app.
    return fallback;
  }
}

/**
 * Persist a setting.
 *
 * Returns whether it actually landed. Most callers can ignore that, but anything holding
 * *money* must not assume a write succeeded: a full quota fails silently here, and a balance
 * the user believes is saved but isn't reappears as "my deposit vanished on reload".
 */
export function writeSetting<T>(key: string, value: T): boolean {
  if (typeof localStorage === 'undefined') return false;

  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ v: VERSION, value } satisfies Envelope<T>));
    return true;
  } catch {
    // Quota exceeded or storage disabled — the app keeps working, it just won't remember.
    return false;
  }
}

/**
 * State that persists itself.
 *
 * Reads happen in an effect rather than during render: the server has no localStorage, so
 * reading it while rendering would produce markup that doesn't match and React would discard
 * the hydration. The stored value is applied immediately after mount instead.
 */
export function usePersistentState<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [state, setState] = useState<T>(fallback);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(readSetting(key, fallback));
    setHydrated(true);
    // `fallback` is intentionally not a dependency — it's the initial default, not an input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (value: T) => {
      setState(value);
      writeSetting(key, value);
    },
    [key]
  );

  // Nothing is written until the stored value has been read, so a first render can't
  // overwrite saved settings with defaults.
  return [hydrated ? state : fallback, update];
}
