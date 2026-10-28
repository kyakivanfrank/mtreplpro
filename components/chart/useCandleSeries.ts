import { useEffect, useRef } from 'react';
import type { IChartApi, ISeriesApi, Logical, Time } from 'lightweight-charts';
import type { Candle, TimeframeKey } from '@/lib/market/types';
import { toCandleData, VISIBLE_BARS, type OHLCInfo } from '@/components/chart/chartConfig';

/** What the chart already holds, so a tick updates one bar instead of resetting all of them. */
interface Applied {
  /** The series instance itself. A new one means a fresh chart, so everything must be re-pushed. */
  series: ISeriesApi<'Candlestick'> | null;
  symbol: string;
  timeframe: TimeframeKey | '';
  count: number;
  firstTime: number;
  lastTime: number;
  ghostAfter: number;
}

/**
 * Pushes store bars into the chart, choosing between `setData` and `update`.
 *
 * `update()` can only ever move the newest bar forward. Anything that rewrites earlier history —
 * a timeframe switch, a symbol switch, a deeper backfill arriving, a replay seek — has to go
 * through `setData`, or lightweight-charts throws "cannot update oldest data".
 */
export function useCandleSeries({
  chartRef,
  seriesRef,
  candles,
  timeframe,
  symbol,
  ghostAfter,
  onOhlc,
}: {
  chartRef: React.RefObject<IChartApi | null>;
  seriesRef: React.RefObject<ISeriesApi<'Candlestick'> | null>;
  candles: Candle[];
  timeframe: TimeframeKey;
  symbol: string;
  ghostAfter: number;
  onOhlc: (ohlc: OHLCInfo) => void;
}) {
  const applied = useRef<Applied>({
    series: null,
    symbol: '',
    timeframe: '',
    count: 0,
    firstTime: 0,
    lastTime: 0,
    ghostAfter: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || candles.length === 0) return;

    const last = candles[candles.length - 1];
    const first = candles[0];
    const previous = applied.current;

    const reseeded =
      previous.series !== series ||
      previous.symbol !== symbol ||
      previous.timeframe !== timeframe ||
      previous.count === 0 ||
      candles.length < previous.count ||
      first.time !== previous.firstTime ||
      last.time < previous.lastTime ||
      // The array is identical but some bars changed side, so their colours have to be
      // re-pushed. Fires once per *bar crossed*, not once per frame — the seeker snaps to bar
      // times, so scrubbing within one bar changes nothing.
      previous.ghostAfter !== ghostAfter;

    /**
     * Only a *symbol or timeframe* change should move the viewport.
     *
     * The other reseed causes — a seek, a weekend skipped, a refresh appending bars — rebuild
     * the series under a user who is looking at a particular place on the chart, and snapping
     * the view on those would yank it out from under them mid-scroll.
     */
    const repositioned = previous.symbol !== symbol || previous.timeframe !== timeframe;

    const heldRange =
      reseeded && !repositioned
        ? chartRef.current?.timeScale().getVisibleLogicalRange() ?? null
        : null;

    if (reseeded) {
      series.setData(candles.map((candle) => toCandleData(candle, ghostAfter)));

      const timeScale = chartRef.current?.timeScale();

      if (heldRange) {
        // Same instrument, same timeframe: keep the user exactly where they were looking.
        timeScale?.setVisibleLogicalRange(heldRange);
      } else {
        // A fresh chart opens on the recent end at a readable density, not zoomed to fit.
        timeScale?.setVisibleLogicalRange({
          from: Math.max(0, candles.length - VISIBLE_BARS) as Logical,
          to: (candles.length + 2) as Logical,
        });
      }
    } else {
      // A tick only ever touches the forming bar; update() also appends when one rolls over.
      series.update({
        time: last.time as Time,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
      });
    }

    applied.current = {
      series,
      symbol,
      timeframe,
      count: candles.length,
      firstTime: first.time,
      lastTime: last.time,
      ghostAfter,
    };
    onOhlc({ open: last.open, high: last.high, low: last.low, close: last.close });
    // `onOhlc` is a setState function and stable; the original effect listed neither it nor the
    // refs, and adding them would re-push every bar on an unrelated render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, timeframe, symbol, ghostAfter]);
}
