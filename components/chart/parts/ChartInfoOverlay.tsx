import React from 'react';
import type { Instrument } from '@/lib/instruments';
import type { OHLCInfo } from '@/components/chart/chartConfig';

/** The symbol, timeframe and — while the window panel is open — the crosshair's OHLC readout. */
export default function ChartInfoOverlay({
  displaySymbol,
  timeframeLabel,
  instrument,
  ohlc,
  showOhlc,
  fmt,
}: {
  displaySymbol: string;
  timeframeLabel: string;
  instrument: Instrument | undefined;
  ohlc: OHLCInfo | null;
  showOhlc: boolean;
  fmt: (price: number) => string;
}) {
  return (
    <div className="absolute top-0 left-0 right-0 px-3 py-2 text-[12px] font-sans tracking-tight z-10 pointer-events-none">
      <div className="flex items-center gap-1.5 flex-wrap">
        {/*
          Uncondensed, unlike the symbol in every list row. Those are columns, and the whole
          column squashes together; this one is a title with no column to fit into, and
          condensing it only made the chart's own label the least legible symbol on the screen.
        */}
        <span className="text-white font-semibold text-[13px] drop-shadow-md">{displaySymbol}</span>
        <span className="text-white text-[9px] mr-0.5 drop-shadow-md">▼</span>
        <span className="text-chartlabel drop-shadow-md">
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
              <span className="text-chartlabel drop-shadow-md">{fmt(ohlc.open)}</span>
              <span className="text-chartlabel drop-shadow-md">{fmt(ohlc.high)}</span>
              <span className="text-chartlabel drop-shadow-md">{fmt(ohlc.low)}</span>
              <span className="text-chartlabel drop-shadow-md">{fmt(ohlc.close)}</span>
            </>
          ) : (
            <span className="text-muted drop-shadow-md">Loading…</span>
          ))}
      </div>
      {/*
        The instrument spelled out, not spelled again. `base` and `quote` are already full names,
        so this reads "Bitcoin vs US Dollar" under the code above it. `quote` is empty for a
        broker-catalogue instrument, and then the name stands alone rather than trailing a "vs".
      */}
      <div className="text-chartlabel text-[13px] mt-0.5 drop-shadow-md">
        {instrument
          ? instrument.quote
            ? `${instrument.base} vs ${instrument.quote}`
            : instrument.base
          : displaySymbol}
      </div>
    </div>
  );
}
