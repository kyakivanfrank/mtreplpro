import type { Candle, Tick } from './types';
import { bucketStartOffset } from './timeframes';

/**
 * A single symbol/timeframe bar series.
 *
 * Seeded once from REST history, then advanced by ticks — the same way MT5 downloads bars
 * from the server and updates only the forming bar from the live feed.
 */
export class CandleSeries {
  private bars: Candle[] = [];
  readonly tfSeconds: number;
  readonly maxBars: number;
  /**
   * Where this timeframe's bars begin, in seconds past midnight UTC.
   *
   * Only D1 has one, and it has to be *the same* offset `rollup` uses. The seeded bars come
   * from the archive, bucketed on the 21:00 forex day; a tick bucketed on midnight lands in a
   * slot no seeded bar occupies, so the series appends a brand new bar instead of extending
   * the one it is inside. That bar opens, highs, lows and closes at a single tick price —
   * which draws as a flat line rather than a candle, one for every day the chart is watched.
   */
  readonly offsetSeconds: number;

  constructor(tfSeconds: number, maxBars = 5000, offsetSeconds = 0) {
    this.tfSeconds = tfSeconds;
    this.maxBars = maxBars;
    this.offsetSeconds = offsetSeconds;
  }

  /** Replace the series with historical bars (oldest first). */
  seed(bars: Candle[]): void {
    this.bars = bars.slice(-this.maxBars);
  }

  get length(): number {
    return this.bars.length;
  }

  /** Oldest-first. The returned array is replaced, never mutated, so React can diff by reference. */
  all(): Candle[] {
    return this.bars;
  }

  last(): Candle | undefined {
    return this.bars[this.bars.length - 1];
  }

  /**
   * Fold a tick into the series. Returns 'new' if it opened a bar, 'update' if it extended
   * the forming one, and 'stale' if the tick predates the series (the session seeked back).
   */
  applyTick(tick: Tick): 'new' | 'update' | 'stale' {
    const seconds = Math.floor(tick.time / 1000);
    const slot = bucketStartOffset(seconds, this.tfSeconds, this.offsetSeconds);
    const current = this.last();

    if (current && slot < current.time) return 'stale';

    if (!current || slot > current.time) {
      // Bars are copied on write so a held reference never mutates underneath React.
      this.bars = [
        ...this.bars,
        { time: slot, open: tick.bid, high: tick.bid, low: tick.bid, close: tick.bid },
      ].slice(-this.maxBars);
      return 'new';
    }

    const updated: Candle = {
      time: current.time,
      open: current.open,
      high: Math.max(current.high, tick.bid),
      low: Math.min(current.low, tick.bid),
      close: tick.bid,
    };
    this.bars = [...this.bars.slice(0, -1), updated];
    return 'update';
  }
}

/**
 * Roll M1 bars up into a coarser timeframe.
 *
 * The one minute archive is the only series the device stores, so every timeframe the chart
 * offers is produced here. Bucketing all of them from the same array is what keeps them
 * consistent by construction: an H4 bar is exactly the minutes inside it, never a separately
 * downloaded bar that disagrees about where four hours begin.
 *
 * `offsetSeconds` shifts the bucket boundary, which only D1 needs — the forex day opens at
 * 21:00 UTC, not midnight.
 */
export function rollup(m1: Candle[], tfSeconds: number, offsetSeconds = 0): Candle[] {
  if (tfSeconds <= 60) return m1;

  const out: Candle[] = [];
  let current: Candle | null = null;

  for (const bar of m1) {
    const slot = bucketStartOffset(bar.time, tfSeconds, offsetSeconds);

    if (!current || current.time !== slot) {
      if (current) out.push(current);
      current = { time: slot, open: bar.open, high: bar.high, low: bar.low, close: bar.close };
      continue;
    }

    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
  }

  if (current) out.push(current);
  return out;
}
