import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Candle, TimeframeKey } from '@/lib/market/types';
import { TIMEFRAMES as TF_SECONDS } from '@/lib/market/timeframes';
import type { ChartCoords } from '@/components/chart/chartCoords';
import { MT5Chart, type PriceMark } from '@/components/chart/engine/MT5Chart';
import { BAR_DOWN, BAR_UP, GHOST_DOWN, GHOST_UP, type OHLCInfo } from '@/components/chart/chartConfig';

/**
 * Mounts the canvas chart, feeds it, and hands back what the screen and its overlays need.
 *
 * `coords` is a stable forwarder: the overlays receive it before the engine exists and keep the
 * same object for the chart's whole life.
 */
export function useChartInstance({
  digits,
  candles,
  symbol,
  timeframe,
  ghostAfter,
  bid,
  marks,
}: {
  digits: number;
  candles: Candle[];
  symbol: string;
  timeframe: TimeframeKey;
  ghostAfter: number;
  bid: number | null;
  marks: PriceMark[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<MT5Chart | null>(null);

  const [corner, setCorner] = useState({ width: 64, height: 26 });
  /** Bumped on every pan, zoom or rescale, so the DOM overlays follow the candles. */
  const [revision, setRevision] = useState(0);
  const [crosshairBar, setCrosshairBar] = useState<OHLCInfo | null>(null);
  const [crosshairOn, setCrosshairOnState] = useState(false);
  const [tapAt, setTapAt] = useState<{ x: number; y: number; n: number } | null>(null);
  const [axisMenuAt, setAxisMenuAt] = useState<{ x: number; y: number } | null>(null);

  // Read inside the mount effect, which must not re-run when they change.
  const digitsRef = useRef(digits);
  digitsRef.current = digits;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const engine = new MT5Chart(
      container,
      { up: BAR_UP, down: BAR_DOWN, ghostUp: GHOST_UP, ghostDown: GHOST_DOWN, bid: BAR_UP },
      digitsRef.current
    );
    engineRef.current = engine;

    engine.onViewportChange = () => {
      setRevision((n) => n + 1);
      const next = engine.corner();
      setCorner((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    engine.onCrosshair = (info) =>
      setCrosshairBar(info ? { open: info.bar.open, high: info.bar.high, low: info.bar.low, close: info.bar.close } : null);
    engine.onCrosshairModeChange = setCrosshairOnState;
    engine.onTap = (x, y) => {
      // A tap in crosshair mode puts the crosshair away; otherwise it opens the chart menu.
      if (engine.isCrosshairMode()) engine.setCrosshairMode(false);
      else setTapAt((prev) => ({ x, y, n: (prev?.n ?? 0) + 1 }));
    };
    engine.onPriceAxisMenu = (x, y) => setAxisMenuAt({ x, y });

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setDigits(digits);
  }, [digits]);

  useEffect(() => {
    engineRef.current?.setData(candles, `${symbol}|${timeframe}`, ghostAfter, TF_SECONDS[timeframe].seconds);
  }, [candles, symbol, timeframe, ghostAfter]);

  useEffect(() => {
    engineRef.current?.setBid(bid);
  }, [bid]);

  useEffect(() => {
    engineRef.current?.setMarks(marks);
  }, [marks]);

  // A different symbol or timeframe drops the crosshair, as the terminal does.
  useEffect(() => {
    engineRef.current?.setCrosshairMode(false);
  }, [symbol, timeframe]);

  const coords: ChartCoords = useMemo(
    () => ({
      timeToX: (time) => engineRef.current?.coords.timeToX(time) ?? null,
      priceToY: (price) => engineRef.current?.coords.priceToY(price) ?? null,
      xToTime: (x) => engineRef.current?.coords.xToTime(x) ?? null,
      yToPrice: (y) => engineRef.current?.coords.yToPrice(y) ?? null,
    }),
    []
  );

  const panBars = useCallback((bars: number) => engineRef.current?.panBars(bars), []);
  const setCrosshair = useCallback((on: boolean) => engineRef.current?.setCrosshairMode(on), []);
  const resetVerticalScale = useCallback(() => engineRef.current?.resetVerticalScale(), []);
  const toggleFreeMove = useCallback(() => {
    const engine = engineRef.current;
    if (engine) engine.setFreeMove(!engine.isFreeMove());
  }, []);
  const isFreeMove = useCallback(() => engineRef.current?.isFreeMove() ?? false, []);

  return {
    containerRef,
    coords,
    corner,
    revision,
    crosshairBar,
    crosshairOn,
    setCrosshair,
    tapAt,
    axisMenuAt,
    closeAxisMenu: () => setAxisMenuAt(null),
    resetVerticalScale,
    toggleFreeMove,
    isFreeMove,
    panBars,
  };
}
