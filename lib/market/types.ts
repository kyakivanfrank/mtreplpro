/* ------------------------------------------------------------------ */
/*  Market data core types                                             */
/* ------------------------------------------------------------------ */
/**
 * Everything in this app is driven by one primitive: a tick.
 *
 * Charts, quotes and the order engine all consume the same `Tick` stream and never talk to a
 * provider directly. Every tick is now produced by the playback session from the device's own
 * minute archive, so what reaches the screen is stored data walked at real-time pace rather
 * than a socket writing under the chart.
 */

export interface Tick {
  symbol: string;
  bid: number;
  ask: number;
  /** Unix milliseconds of *session* time — where the clock has played to, not wall-clock. */
  time: number;
}

export interface Candle {
  /** Unix seconds at the start of the bar's bucket. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type TimeframeKey = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN';

export type TickHandler = (tick: Tick) => void;
