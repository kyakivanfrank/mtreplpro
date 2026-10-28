/**
 * The four conversions between the chart's pixels and the market.
 *
 * Every overlay — the veil, the order levels, the trade lines — works purely in pixels and is
 * handed one of these. That keeps every lightweight-charts detail on the chart's side of the
 * boundary, and it is why none of those components import the charting library at all.
 *
 * Each function returns null when the value is off-screen or the chart is not ready, which the
 * callers treat as "draw nothing" rather than as an error.
 */
export interface ChartCoords {
  /** Unix seconds → x, in pixels from the chart's left edge. */
  timeToX: (time: number) => number | null;
  priceToY: (price: number) => number | null;
  xToTime: (x: number) => number | null;
  yToPrice: (y: number) => number | null;
}
