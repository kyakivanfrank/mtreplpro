import { useEffect, useMemo, useState } from 'react';
import type { Instrument } from '@/lib/instruments';
import { marketStore, usePublished, useQuotes } from '@/lib/market/store';
import { STORAGE_KEYS, scopedKey, usePersistentState } from '@/lib/storage';
import { useAccountScope } from '@/lib/account';
import { INITIAL_ROWS, reconcileRows, type Row } from '@/components/quotes/watchlist';

/**
 * The board's state: what is on it, what it is priced at, and which row an edit lands on.
 *
 * Pulled out of the view so the screen is left describing its layout. Everything here is about
 * the difference between the *stored* watchlist and the *visible* one, which is the one thing on
 * this screen that is genuinely subtle.
 */
export function useWatchlist() {
  // The watchlist is a user setting: whatever they put here is what they see next launch.
  const scope = useAccountScope();
  const [storedRows, setRows] = usePersistentState<Row[]>(
    scopedKey(STORAGE_KEYS.watchlist, scope),
    INITIAL_ROWS
  );
  const allRows = useMemo(() => reconcileRows(storedRows), [storedRows]);

  /*
   * Only instruments the terminal is actually publishing reach the board — a row that can only
   * ever show dashes is indistinguishable from a broken feed.
   *
   * The stored watchlist is left untouched, so a symbol that is merely mid-backfill comes back
   * by itself once published, in the user's order. Before the catalogue lands there is nothing
   * to filter against and an empty board would read as a broken app, so the saved rows stand.
   */
  const published = usePublished();
  const rows = useMemo(
    () =>
      published.length === 0
        ? allRows
        : allRows.filter((row) => published.includes(row.symbol)),
    [allRows, published]
  );

  const [targetIndex, setTargetIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);

  // One shared tick stream drives every row — no polling, no per-row fetching.
  const symbols = useMemo(() => rows.map((r) => r.symbol), [rows]);
  const quotes = useQuotes(symbols);

  // Kept warm for the whole session, not just while this screen is mounted: a symbol added here
  // should already have its prices and bars when the chart is opened on it.
  useEffect(() => {
    marketStore.setWatchlist(symbols);
  }, [symbols]);

  const openPicker = (index: number) => {
    setTargetIndex(index);
    setPickerOpen(true);
  };

  const selectInstrument = (instrument: Instrument) => {
    /*
     * Edits address the row by symbol, against the *stored* list rather than the visible one.
     *
     * The board can be a subset, so writing the visible rows straight back would quietly delete
     * every hidden one the moment an unrelated row changed. Matching on the symbol keeps
     * positions stable and leaves rows waiting on the publisher where the user put them.
     */
    const replacing = rows[targetIndex]?.symbol;
    const next: Row = { symbol: instrument.symbol, display: instrument.display };

    setRows(
      replacing
        ? allRows.map((row) => (row.symbol === replacing ? next : row))
        : [...allRows, next]
    );
    setPickerOpen(false);
  };

  return {
    rows,
    quotes,
    targetIndex,
    pickerOpen,
    openPicker,
    closePicker: () => setPickerOpen(false),
    selectInstrument,
  };
}
