/* ------------------------------------------------------------------ */
/*  Shared quote types + pure helpers (safe on both server and client) */
/* ------------------------------------------------------------------ */

/** "EUR/USD" → "EURUSD" */
export function displaySymbol(symbol: string): string {
  return symbol.replace('/', '');
}

/**
 * Split a price the way MT5 renders it.
 *
 * Fractional-pip instruments (5- and 3-digit forex) put the last digit in superscript:
 * 1.13169 → "1.13" + big "16" + sup "9". Gold and crypto quote in whole cents with no
 * fractional pip, so they just get big last-two-digits: 4375.63 → "4375." + big "63".
 */
export function splitPrice(price: number, digits: number) {
  const s = price.toFixed(digits);

  if (digits !== 3 && digits !== 5) {
    return { prefix: s.slice(0, -2), big: s.slice(-2), sup: '' };
  }
  return { prefix: s.slice(0, -3), big: s.slice(-3, -1), sup: s.slice(-1) };
}

export function formatPoints(points: number): string {
  return points > 0 ? `+${points}` : `${points}`;
}

export function formatPercent(pct: number): string {
  const v = pct.toFixed(2);
  return pct > 0 ? `+${v}%` : `${v}%`;
}

export function formatTime(timestamp: number): string {
  if (!timestamp) return '--:--:--';
  return new Date(timestamp * 1000).toLocaleTimeString('en-GB', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
