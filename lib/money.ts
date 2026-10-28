/* ------------------------------------------------------------------ */
/*  Money, in the three forms the terminal writes it                   */
/* ------------------------------------------------------------------ */
/*
 * Trade, History and the chart's trade lines each had a private `money()`, and they disagreed —
 * the same balance rendered `10 000.00` in one panel and `10000.00` in the next. Collected here
 * as three named choices. The differences are real; they are just no longer accidental.
 */

/** Plain 2dp: `10000.00`. The dense-list form — no grouping to cost width in every row. */
export function money(value: number): string {
  return value.toFixed(2);
}

/**
 * Grouped, MT5-style: `10 000.00`, `-10 945.00`.
 *
 * The separator is a literal U+00A0, not an ordinary space: an ordinary one lets a figure wrap
 * mid-number and stack as two. It is invisible in a diff, so check it first if a balance ever
 * starts wrapping. A space rather than a comma because a comma is the decimal mark in half the
 * locales MT5 ships to.
 */
export function groupedMoney(value: number): string {
  const [whole, fraction] = Math.abs(value).toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${value < 0 ? '-' : ''}${grouped}.${fraction}`;
}

/** `-12.40 USD` — for figures floating on the chart with no column header to name the unit. */
export function moneyWithCurrency(value: number, currency = 'USD'): string {
  return `${money(value)} ${currency}`;
}
