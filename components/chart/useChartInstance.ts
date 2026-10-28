import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  Logical,
  Time,
} from 'lightweight-charts';
import type { Candle } from '@/lib/market/types';
import type { ChartCoords } from '@/components/chart/chartCoords';
import {
  CANDLE_SERIES_OPTIONS,
  CHART_OPTIONS,
  priceFormatFor,
  type OHLCInfo,
} from '@/components/chart/chartConfig';

/**
 * Creates the chart, keeps it sized, and hands back the handles the screen needs.
 *
 * `candles` is taken only to keep a ref current for the coordinate closures — this hook never
 * pushes data. That is `useCandleSeries`.
 */
export function useChartInstance(digits: number, candles: Candle[]) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  const [ohlc, setOhlc] = useState<OHLCInfo | null>(null);

  /* ---------- where the ••• sits against the two scales ---------- */
  /**
   * The ••• is a chip laid *over* the bottom of the price column, not a filler for the corner
   * underneath it.
   *
   * It used to occupy that corner at a hard-coded 50×28 — the one size that square almost never
   * is — which also took the corner away from the time scale, so the last tick had nowhere to
   * go. It moves up by the height of the time row instead and covers the lowest price label,
   * the one strip of the column with nothing to say. Both numbers come from the scales, not
   * from this file.
   */
  const [corner, setCorner] = useState({ width: 50, height: 28 });

  const measureCorner = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const width = chart.priceScale('right').width();
    const height = chart.timeScale().height();
    if (width <= 0 || height <= 0) return;

    setCorner((previous) =>
      previous.width === width && previous.height === height ? previous : { width, height }
    );
  }, []);

  // Read inside the chart-init effect, which must not re-run when the instrument changes.
  const digitsRef = useRef(digits);
  digitsRef.current = digits;

  // Read inside coordinate closures that must not be rebuilt on every bar.
  const candlesRef = useRef<Candle[]>(candles);
  candlesRef.current = candles;

  /* ---------- price precision follows the instrument ---------- */
  useEffect(() => {
    seriesRef.current?.applyOptions({ priceFormat: priceFormatFor(digits) });
    // A different number of decimals is a different price-scale width, and the ••• has to
    // follow it rather than be left overlapping the column.
    requestAnimationFrame(measureCorner);
  }, [digits, measureCorner]);

  /* ---------- init chart ---------- */
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const chart = createChart(container, CHART_OPTIONS);
    const series = chart.addSeries(CandlestickSeries, CANDLE_SERIES_OPTIONS);

    // Precision is instrument-specific and the chart outlives a symbol switch.
    series.applyOptions({ priceFormat: priceFormatFor(digitsRef.current) });

    chartRef.current = chart;
    seriesRef.current = series;

    // Subscribe to crosshair move to update OHLC
    chart.subscribeCrosshairMove((param) => {
      if (param.seriesData && param.seriesData.size > 0) {
        const candleData = param.seriesData.get(series) as CandlestickData<Time> | undefined;
        if (candleData) {
          setOhlc({
            open: candleData.open,
            high: candleData.high,
            low: candleData.low,
            close: candleData.close,
          });
        }
      }
    });

    // Responsive resize
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        chart.resize(width, height);
      }
      measureCorner();
    });
    resizeObserver.observe(container);

    // Scrolling into a different price range rewrites the labels, and a longer label is a
    // wider price scale — so the corner is re-read on every move, not only on resize.
    chart.timeScale().subscribeVisibleLogicalRangeChange(measureCorner);
    requestAnimationFrame(measureCorner);

    /*
     * MT5-style corner: make the time scale run edge-to-edge.
     *
     * lightweight-charts builds its layout as a <table> with two rows:
     *   Row 1: [empty left stub] [chart canvases] [price axis]
     *   Row 2: [empty left stub] [time scale]     [right stub ← THE PROBLEM]
     *
     * The right stub in row 2 is a PriceAxisStub — a blank 66×28 rectangle in the bottom-
     * right corner. In real MT5 there is no such box; the timeline stretches fully across
     * under the price scale.
     *
     * The fix: remove the stub <td> from the DOM entirely and give the time scale cell
     * colSpan=2 so it spans both the time column and the price-axis column. The table
     * columns in row 1 (chart area + price axis) keep their widths unchanged, so the
     * price scale is unaffected. The time scale td becomes the full chart width; its
     * canvases keep their library-managed size (948px) and stay synchronised with the
     * candles above. The extra space on the right is seamless empty background.
     */
    const chartEl = container.querySelector('.tv-lightweight-charts');
    if (chartEl) {
      const table = chartEl.querySelector('table');
      if (table) {
        const rows = table.querySelectorAll('tr');
        const lastRow = rows[rows.length - 1];
        if (lastRow) {
          const cells = lastRow.querySelectorAll('td');
          if (cells.length >= 2) {
            // Hide the stub cell instead of removing it, so the library doesn't crash on resize
            const stubCell = cells[cells.length - 1] as HTMLTableCellElement;
            stubCell.style.display = 'none';

            // Make the time scale cell span the stub's column
            const timeScaleCell = cells[cells.length - 2] as HTMLTableCellElement;
            timeScaleCell.colSpan = 2;
            
            // Add a class so we can safely target it in globals.css without breaking other charts
            timeScaleCell.classList.add('mt5-timeline-cell');
          }
        }
      }
    }

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(measureCorner);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [measureCorner]);

  /**
   * The bridge between pixels and the market, handed to the window and level markers.
   *
   * Everything goes through the *logical* index rather than the timestamp. The time scale here
   * is index-based — that is what closes the weekend gaps — so a coordinate maps to a bar
   * position, and only the bar knows what time it is.
   */
  const coords: ChartCoords = useMemo(
    () => ({
      timeToX: (time) => {
        const chart = chartRef.current;
        const bars = candlesRef.current;
        if (!chart || bars.length === 0) return null;

        const index = bars.findIndex((bar) => bar.time === time);
        if (index === -1) return null;

        return chart.timeScale().logicalToCoordinate(index as unknown as Logical);
      },
      priceToY: (price) => seriesRef.current?.priceToCoordinate(price) ?? null,
      xToTime: (x) => {
        const chart = chartRef.current;
        const bars = candlesRef.current;
        if (!chart || bars.length === 0) return null;

        const logical = chart.timeScale().coordinateToLogical(x);
        if (logical === null) return null;

        const index = Math.min(bars.length - 1, Math.max(0, Math.round(logical)));
        return bars[index].time;
      },
      yToPrice: (y) => {
        const price = seriesRef.current?.coordinateToPrice(y);
        return typeof price === 'number' ? price : null;
      },
    }),
    []
  );

  /** Scroll the time scale by whole-ish bars, so a drag held at an edge can keep travelling. */
  const panBars = useCallback((bars: number) => {
    const timeScale = chartRef.current?.timeScale();
    if (!timeScale) return;

    const position = timeScale.scrollPosition();
    if (typeof position === 'number') timeScale.scrollToPosition(position + bars, false);
  }, []);

  return { containerRef, chartRef, seriesRef, coords, corner, ohlc, setOhlc, panBars };
}
