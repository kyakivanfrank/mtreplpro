import type { QuoteState } from '@/lib/market/store';
import { closePriceFor, positionNet } from '@/lib/trading/math';
import type { Position } from '@/lib/trading/types';
import { findInstrument } from '@/lib/instruments';
import { money } from '@/lib/money';
import { stampSecond } from '@/lib/timeFormat';

/* ------------------------------------------------------------------ */
/*  One position, two views                                            */
/* ------------------------------------------------------------------ */
/**
 * Everything both views of a position need, worked out once.
 *
 * The row and the sheet's header show the same trade at two levels of detail. Deriving them
 * separately is how a row ends up quoting a price to two decimals that the sheet quotes to three.
 */
export interface PositionView {
  symbol: string;
  /** The instrument spelled out — "Gold vs US Dollar". */
  description: string;
  openPrice: string;
  currentPrice: string;
  delta: { points: string; percent: string; rising: boolean };
  stopLevel: string;
  targetLevel: string;
  openStamp: string;
  profit: string;
  isProfit: boolean;
}

/**
 * How far the market has moved since entry, in points and as a share of the entry.
 *
 * Points rather than price: a difference of 127.410 means nothing without knowing the
 * instrument's increment. Signed by direction of price, not of profit — see where it renders.
 */
export function priceDelta(
  position: Position,
  current: number | null,
  point: number
): { points: string; percent: string; rising: boolean } {
  if (current === null || !point || position.openPrice === 0) {
    return { points: '—', percent: '—', rising: true };
  }

  const move = current - position.openPrice;
  const points = Math.round(move / point);
  const percent = (move / Math.abs(position.openPrice)) * 100;

  return {
    // Ungrouped: a count of increments, not an amount of money. Grouping would make it read as
    // a currency figure one line under an actual currency figure.
    points: String(points),
    percent: `${percent.toFixed(2)}%`,
    rising: move >= 0,
  };
}

/**
 * The instrument written out — "Gold vs US Dollar", for somebody looking at `XAUUSDm`.
 *
 * "Spot" is stripped: it is a fact about settlement, not part of the name. A broker-only symbol
 * carries no quote currency, so it stands alone rather than trailing a " vs " with nothing after.
 */
export function instrumentTitle(instrument: ReturnType<typeof findInstrument>): string | null {
  if (!instrument) return null;

  const base = instrument.base.replace(/\s+spot$/i, '');
  return instrument.quote ? `${base} vs ${instrument.quote}` : base;
}

export function positionView(
  position: Position,
  quotes: Record<string, QuoteState>,
  toBrokerSymbol: (display: string) => string
): PositionView {
  const quote = quotes[position.symbol];
  const instrument = findInstrument(position.symbol);
  const digits = instrument?.digits ?? 2;

  const profit = positionNet(position, quote, quotes);
  const current = closePriceFor(position, quote);

  return {
    // Display only — position.symbol stays canonical for pricing.
    symbol: toBrokerSymbol(position.symbol),
    description: instrumentTitle(instrument) ?? position.symbol,
    openPrice: position.openPrice.toFixed(digits),
    currentPrice: current !== null ? current.toFixed(digits) : '—',
    delta: priceDelta(position, current, instrument?.point ?? 10 ** -digits),
    stopLevel: position.sl !== null ? position.sl.toFixed(digits) : '-',
    targetLevel: position.tp !== null ? position.tp.toFixed(digits) : '-',
    openStamp: stampSecond(position.openTime),
    profit: profit !== null ? money(profit) : '—',
    isProfit: (profit ?? 0) >= 0,
  };
}
