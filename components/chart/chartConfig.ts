import type { CandlestickData, DeepPartial, ChartOptions, Time } from 'lightweight-charts';
import type { Candle, TimeframeKey } from '@/lib/market/types';

/* ------------------------------------------------------------------ */
/*  Candle colours                                                     */
/* ------------------------------------------------------------------ */
/**
 * Teal-green up, coral down — the pair MT5 and TradingView both settled on for a dark chart.
 * Pure channels vibrate against near-black and do not sit at the same apparent brightness, so a
 * wall of them reads as one loud side and one calm one. Nothing in this app is signalled by
 * candle colour alone, because the hue helps colourblind readers either way.
 */
export const BAR_UP = '#25A69B';
export const BAR_DOWN = '#EE534E';

/**
 * The unplayed form of each: the *same hue* at reduced opacity, never a flat grey.
 *
 * The point of drawing the future at all is to read its shape and direction before choosing
 * where to start, and a region where an up bar and a down bar look alike answers neither
 * question. Low enough to be obviously not-yet-real, high enough to still read as candles.
 */
const GHOST_OPACITY = 0.2;

export const GHOST_UP = `rgba(37, 166, 155, ${GHOST_OPACITY})`;
export const GHOST_DOWN = `rgba(238, 83, 78, ${GHOST_OPACITY})`;

/* ------------------------------------------------------------------ */
/*  Timeframes and defaults                                            */
/* ------------------------------------------------------------------ */
export const TIMEFRAMES: { label: string; value: TimeframeKey }[] = [
  { label: 'M1', value: 'M1' },
  { label: 'M5', value: 'M5' },
  { label: 'M15', value: 'M15' },
  { label: 'M30', value: 'M30' },
  { label: 'H1', value: 'H1' },
  { label: 'H4', value: 'H4' },
  { label: 'D1', value: 'D1' },
  { label: 'W1', value: 'W1' },
  { label: 'MN', value: 'MN' },
];

/** Gold is the default instrument, matching the top row of the watchlist. */
export const DEFAULT_CHART_SYMBOL = 'XAUUSD';

/** Opening timeframe for a device that has never set one. A stored preference wins over it. */
export const DEFAULT_TIMEFRAME: TimeframeKey = 'M15';

/**
 * Bars visible after a reseed.
 *
 * `fitContent()` used to run here, which fits *everything* into the viewport — fine at a few
 * hundred bars, wrong at ten thousand, where opening a chart showed weeks of minutes as a smear.
 * MT5 opens on the recent end at a readable density and leaves the rest to be scrolled into.
 */
export const VISIBLE_BARS = 150;

/** The one-click trade row's open height. Matches the `h-[48px]` on the row itself. */
export const TRADE_BAR_HEIGHT = 48;

/**
 * The chart's three mutually exclusive surfaces, or none of them.
 *
 * They were three independent booleans and could all be true at once, which on a phone-sized
 * chart meant three things competing for a screen with room for one. One nullable value means
 * they cannot disagree: opening any of them closes whatever was out.
 */
export type ChartMode = 'trade' | 'timeframes' | 'setup' | null;

export interface OHLCInfo {
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Which level of an order is being named or aimed at.
 *
 * Declared here because the two records below are keyed on it. It was written out separately in
 * the order ticket and in the level picker, which pass values of it to each other.
 */
export type LevelField = 'price' | 'sl' | 'tp';

/** Order levels are drawn in the colours they will keep once the order exists. */
export const LEVEL_LABELS: Record<LevelField, string> = {
  price: 'Entry price',
  sl: 'Stop Loss',
  tp: 'Take Profit',
};

export const LEVEL_COLORS: Record<LevelField, string> = {
  price: '#0A84FF',
  sl: '#FF453A',
  tp: '#30D158',
};

/* ------------------------------------------------------------------ */
/*  lightweight-charts options                                         */
/* ------------------------------------------------------------------ */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** UTC, to match every other stamp in the app. */
function tickMarkFormatter(time: number): string {
  const d = new Date(time * 1000);
  const day = d.getUTCDate();
  const month = MONTHS[d.getUTCMonth()];
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${hours}:${minutes}`;
}

/** Everything the chart is created with. Pure data, so the init effect stays readable. */
export const CHART_OPTIONS: DeepPartial<ChartOptions> = {
  autoSize: true,
  layout: {
    background: { color: '#000000' },
    textColor: '#8e8e93',
    /*
     * Both axes, not just the time row -- lightweight-charts documents this as "font size of
     * text on scales" and exposes no per-scale override, so the price labels shrink with it.
     *
     * The time row's height and the price column's width are both read back off the chart in
     * `useChartInstance.measureCorner`, so the ••• chip and the corner hairline follow this
     * number on their own. Nothing else needs changing when it moves.
     */
    fontSize: 11,
    attributionLogo: false,
  },
  grid: {
    vertLines: { visible: false },
    horzLines: { visible: false },
  },
  crosshair: {
    mode: 0, // Normal
    horzLine: {
      visible: true,
      style: 2, // Dashed
      color: 'rgba(255, 255, 255, 0.25)',
      width: 1,
      labelVisible: true,
      labelBackgroundColor: '#2962FF',
    },
    vertLine: {
      visible: true,
      style: 2,
      color: 'rgba(255, 255, 255, 0.25)',
      width: 1,
      labelVisible: true,
      labelBackgroundColor: '#363a45',
    },
  },
  rightPriceScale: {
    visible: true,
    borderVisible: true,
    borderColor: '#2b2f3a',
    scaleMargins: { top: 0.1, bottom: 0.1 },
  },
  timeScale: {
    visible: true,
    borderVisible: true,
    borderColor: '#2b2f3a',
    timeVisible: true,
    secondsVisible: false,
    tickMarkFormatter,
  },
};

export const CANDLE_SERIES_OPTIONS = {
  upColor: BAR_UP,
  downColor: BAR_DOWN,
  borderUpColor: BAR_UP,
  borderDownColor: BAR_DOWN,
  wickUpColor: BAR_UP,
  wickDownColor: BAR_DOWN,
  priceFormat: {
    type: 'price' as const,
    precision: 5,
    minMove: 0.00001,
  },
};

/** The price format for an instrument's decimal count. */
export function priceFormatFor(digits: number) {
  return { type: 'price' as const, precision: digits, minMove: 10 ** -digits };
}

/**
 * A bar, coloured for which side of the seeker it falls on.
 *
 * Played bars carry no per-bar colours at all, so they fall through to the series options and
 * render byte-for-byte as they did before ghosting existed. Only the future is touched.
 */
export function toCandleData(candle: Candle, ghostAfter: number): CandlestickData<Time> {
  const base = {
    time: candle.time as Time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };

  if (candle.time <= ghostAfter) return base;

  const ghost = candle.close >= candle.open ? GHOST_UP : GHOST_DOWN;
  return { ...base, color: ghost, borderColor: ghost, wickColor: ghost };
}
