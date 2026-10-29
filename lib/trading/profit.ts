'use client';

import { useMemo } from 'react';
import { useQuotes } from '@/lib/market/store';
import { accountSummary } from './math';
import { useBook } from './store';

/* ------------------------------------------------------------------ */
/*  How open profit is coloured                                        */
/* ------------------------------------------------------------------ */
/**
 * One rule, in one place, because two things now show it.
 *
 * The trade header's running total and the nav bar's Trade tab have to agree: they sit on the
 * same screen showing the same account, and a header reading blue above a red tab would be
 * two different answers to one question. Keeping the rule here rather than in either component
 * is what stops them drifting the next time one of them is edited.
 */

/** Nothing at stake. Distinct from profit on purpose — flat is not a small win. */
export const PROFIT_FLAT = '#FFFFFF';
export const PROFIT_UP = '#0A84FF';
export const PROFIT_DOWN = '#F04534';

/**
 * Colour for a profit figure.
 *
 * Keyed off the *rounded* value rather than the raw one. Open profit is a float that is almost
 * never exactly zero — a hundredth of a cent of drift is enough — so testing the raw number
 * would tint a row reading "0.00" blue or red for a difference the user cannot see. What is
 * displayed is what gets coloured.
 */
export function profitColor(value: number): string {
  const shown = Number(value.toFixed(2));
  if (shown > 0) return PROFIT_UP;
  if (shown < 0) return PROFIT_DOWN;
  return PROFIT_FLAT;
}

/**
 * Total open profit across the book, live.
 *
 * Subscribes to quotes for exactly the symbols currently held, so a component using this
 * re-renders on ticks that can actually change the number and on nothing else.
 */
export function useOpenProfit(): number {
  const book = useBook();

  const symbols = useMemo(
    () => [...new Set(book.positions.map((position) => position.symbol))],
    [book.positions]
  );

  const quotes = useQuotes(symbols);

  return accountSummary(book.balance, book.positions, quotes).openProfit;
}
