import { findInstrument } from '@/lib/instruments';
import { SYMBOLS } from '@/lib/symbols';

export interface Row {
  symbol: string;   // canonical, "EURUSD"
  display: string;  // canonical too — the settings suffix is applied when the row renders
}

/**
 * What a fresh install starts with.
 *
 * Gold and bitcoin lead because they are the two that keep moving when everything else is shut,
 * so a first launch on a weekend still shows a live board. No hard-coded seed prices behind
 * them: a row with no tick yet shows dashes and its own name.
 */
export const INITIAL_ROWS: Row[] = SYMBOLS.map((symbol) => ({
  symbol,
  display: findInstrument(symbol)?.display ?? symbol,
}));

/**
 * Reconcile a stored watchlist: keep what still resolves, in the user's order, drop the rest.
 *
 * The defaults are seeded only when nothing is saved at all — the picker offers whatever the
 * broker lists, so a watchlist is no longer pinned to a fixed six.
 */
export function reconcileRows(stored: Row[]): Row[] {
  const kept = stored.filter((row) => Boolean(findInstrument(row.symbol)));
  if (kept.length === 0) return INITIAL_ROWS;

  // Re-derive the label each launch so a row follows the table rather than showing whatever was
  // saved months ago. The account-type suffix is added at render, never stored.
  return kept.map((row) => ({
    symbol: row.symbol,
    display: findInstrument(row.symbol)?.display ?? row.display,
  }));
}
