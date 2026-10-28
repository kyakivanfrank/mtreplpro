import { formatPercent, formatPoints, formatTime, splitPrice } from '@/lib/forex';
import type { QuoteState } from '@/lib/market/store';
import { resultTone } from '@/components/ui/tone';

/** One side of the quote, split the way MT5 renders it — big digits, superscript fractional pip. */
export interface PriceCell {
  prefix: string;
  big: string;
  sup: string;
  color: string;
}

export interface QuoteItemProps {
  pts: string;
  pct: string;
  symbol: string;
  time: string;
  spread: string;
  changeColor: string;
  bid: PriceCell;
  low: string;
  ask: PriceCell;
  high: string;
}

const IDLE = 'text-muted';

/** A symbol just dropped into a row, before its first tick arrives. */
export function placeholder(display: string): QuoteItemProps {
  const blank: PriceCell = { prefix: '—', big: '', sup: '', color: IDLE };

  return {
    pts: '—',
    pct: '—',
    symbol: display,
    time: '--:--:--',
    spread: '—',
    changeColor: IDLE,
    bid: blank,
    low: '—',
    ask: { ...blank },
    high: '—',
  };
}

export function toItemProps(quote: QuoteState): QuoteItemProps {
  const bid = splitPrice(quote.bid, quote.digits);
  const ask = splitPrice(quote.ask, quote.digits);
  // Both sides take the tick's own direction, so the whole row flashes one way on each update.
  const tickColor = resultTone(quote.direction === 'up');

  return {
    pts: formatPoints(quote.changePoints),
    pct: formatPercent(quote.changePercent),
    symbol: quote.display,
    time: formatTime(Math.floor(quote.time / 1000)),
    spread: String(quote.spread),
    changeColor: resultTone(quote.changePercent >= 0),
    bid: { prefix: bid.prefix, big: bid.big, sup: bid.sup, color: tickColor },
    low: quote.low.toFixed(quote.digits),
    ask: { prefix: ask.prefix, big: ask.big, sup: ask.sup, color: tickColor },
    high: quote.high.toFixed(quote.digits),
  };
}
