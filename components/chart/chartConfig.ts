import type { TimeframeKey } from '@/lib/market/types';

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

/** The same colour at the ghost opacity, for whatever candle colours the user has picked. */
export function ghostOf(hex: string): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(n)) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${GHOST_OPACITY})`;
}

/* ------------------------------------------------------------------ */
/*  Chart settings (the chart menu's Settings page)                    */
/* ------------------------------------------------------------------ */
/** Colours are 6-digit hex so they round-trip through the native colour picker. */
export interface ChartSettings {
  grid: boolean;
  bidLine: boolean;
  colors: {
    background: string;
    foreground: string;
    grid: string;
    bull: string;
    bear: string;
    bid: string;
  };
}

/**
 * Grid on, as on the real terminal: dashed `#373B4C`, measured off references/IMG_0074.PNG (the
 * geometry is in the engine). The owner first had it off (docs/MT5_PARITY.md), then asked for it.
 */
export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  grid: true,
  bidLine: true,
  colors: {
    background: '#000000',
    foreground: '#d4d4d4',
    grid: '#373b4c',
    bull: BAR_UP.toLowerCase(),
    bear: BAR_DOWN.toLowerCase(),
    bid: BAR_UP.toLowerCase(),
  },
};

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

/** The one-click trade row's open height: 40pt on the real terminal. */
export const TRADE_BAR_HEIGHT = 40;

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
