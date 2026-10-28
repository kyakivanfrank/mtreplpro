/* ------------------------------------------------------------------ */
/*  The tracked set                                                    */
/* ------------------------------------------------------------------ */
/**
 * What may be charted.
 *
 * This used to be six instruments fixed at build time, for a real reason: the archive was
 * filled by a server-side backfill against a metered provider, so a symbol could be selected
 * before any history existed for it, and an open set had no bounded storage cost.
 *
 * Neither constraint survives the bridge. History comes from the broker's own terminal on
 * demand — there is nothing to backfill in advance and no per-symbol credit to spend — and the
 * archive is now capped by *count* of symbols with least-recently-viewed eviction rather than
 * by a fixed list. So the set is whatever the broker offers.
 *
 * These are the defaults a fresh install starts its watchlist with. The picker offers
 * everything in the instrument table, plus anything else the catalogue reports.
 */
export const SYMBOLS = [
  'XAUUSD',
  'BTCUSD',
  'EURUSD',
  'GBPUSD',
  'USDJPY',
  'AUDUSD',
] as const;

