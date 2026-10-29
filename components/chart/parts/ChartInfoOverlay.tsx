import React from 'react';
import type { Instrument } from '@/lib/instruments';
import type { OHLCInfo } from '@/components/chart/chartConfig';

/**
 * The symbol, timeframe and — while the window panel is open — the crosshair's OHLC readout.
 * The terminal's: the symbol in blue with its ▾, everything else in the axis grey, all 13pt.
 */
export default function ChartInfoOverlay({
  displaySymbol,
  timeframeLabel,
  instrument,
  ohlc,
  showOhlc,
  hint,
  rightInset,
  fmt,
}: {
  displaySymbol: string;
  timeframeLabel: string;
  instrument: Instrument | undefined;
  ohlc: OHLCInfo | null;
  showOhlc: boolean;
  /** Replaces the description line while a mode is active, as the crosshair's hint does. */
  hint?: string;
  /** The price column's width: the readout stops at the plot's edge. */
  rightInset: number;
  fmt: (price: number) => string;
}) {
  return (
    <div style={{ right: rightInset + 4 }} className="absolute top-0 left-0 px-1 pt-[3px] text-[13px] leading-[17px] text-[#d8d8d8] z-10 pointer-events-none">
      <div className="flex items-center gap-1 whitespace-nowrap overflow-hidden">
        <span className="text-[#1a80e8]">{displaySymbol}</span>
        <span className="text-[#1a80e8] text-[8px] mx-0.5">▼</span>
        <span>
          {timeframeLabel}
          {showOhlc ? ',' : ''}
        </span>

        {/*
          Held for the window-panel mode only. Outside it there is no crosshair to read, so the
          four numbers either sat on a stale bar from the last time a finger crossed the chart or
          said "Loading…" forever — either way, not the price the chart was showing.
        */}
        {showOhlc &&
          (ohlc ? (
            <>
              <span>{fmt(ohlc.open)}</span>
              <span>{fmt(ohlc.high)}</span>
              <span>{fmt(ohlc.low)}</span>
              <span>{fmt(ohlc.close)}</span>
            </>
          ) : (
            <span className="text-muted">Loading…</span>
          ))}
      </div>
      {/*
        The instrument spelled out, not spelled again. `base` and `quote` are already full names,
        so this reads "Bitcoin vs US Dollar" under the code above it. `quote` is empty for a
        broker-catalogue instrument, and then the name stands alone rather than trailing a "vs".
      */}
      <div>
        {hint ?? (instrument
          ? instrument.quote
            ? `${instrument.base} vs ${instrument.quote}`
            : instrument.base
          : displaySymbol)}
      </div>
    </div>
  );
}
