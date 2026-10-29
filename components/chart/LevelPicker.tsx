'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ChartCoords } from '@/components/chart/chartCoords';
import type { Candle } from '@/lib/market/types';
import type { LevelField } from '@/components/chart/chartConfig';
import { stampMinute } from '@/lib/timeFormat';

/* ------------------------------------------------------------------ */
/*  Order level picker                                                 */
/* ------------------------------------------------------------------ */
/**
 * A crosshair for aiming one order level at the chart.
 *
 * Typing 3419.60 into a field tells you nothing about where that sits — above the last swing
 * high, inside the range, a hair under the price. The ticket's number is exact but blind, so
 * each level can instead be dragged onto the candles, where the horizontal line is the level
 * itself and the vertical one names the candle and minute you are aiming at. That is the whole
 * point of the time readout: on a chart being played back, "which candle" is as much a part of
 * placing a stop as "which price".
 *
 * One level at a time, in the colour it will be drawn in: blue for the entry, red for the stop,
 * green for the target.
 */

export type { LevelField };

interface LevelPickerProps {
  field: LevelField;
  label: string;
  color: string;
  /** Where the crosshair opens — whatever the ticket already holds, or the market price. */
  initialPrice: number;
  candles: Candle[];
  coords: ChartCoords;
  digits: number;
  /** Bumped by the chart whenever it pans, zooms or receives new bars. */
  revision: number;
  onSet: (field: LevelField, price: number) => void;
  onCancel: () => void;
}

export default function LevelPicker({
  field,
  label,
  color,
  initialPrice,
  candles,
  coords,
  digits,
  revision,
  onSet,
  onCancel,
}: LevelPickerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const [price, setPrice] = useState(initialPrice);
  const [time, setTime] = useState(() => candles[candles.length - 1]?.time ?? 0);

  const move = useCallback(
    (clientX: number, clientY: number) => {
      const layer = layerRef.current;
      if (!layer) return;

      const rect = layer.getBoundingClientRect();
      const nextPrice = coords.yToPrice(clientY - rect.top);
      const nextTime = coords.xToTime(clientX - rect.left);

      if (nextPrice !== null) setPrice(nextPrice);

      // Snapped to a real candle, so the readout names a bar that exists rather than the gap
      // between two.
      if (nextTime !== null && candles.length > 0) {
        let best = candles[0];
        let bestGap = Math.abs(candles[0].time - nextTime);
        for (const candle of candles) {
          const gap = Math.abs(candle.time - nextTime);
          if (gap < bestGap) {
            best = candle;
            bestGap = gap;
          }
        }
        setTime(best.time);
      }
    },
    [coords, candles]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      e.preventDefault();
      move(e.clientX, e.clientY);
    };
    const onUp = () => {
      dragging.current = false;
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [move]);

  // `revision` is what re-runs this after a pan or zoom.
  void revision;

  const y = coords.priceToY(price);
  const x = coords.timeToX(time);

  return (
    <>
      <div ref={layerRef} className="absolute inset-0 z-30 pointer-events-none">
        <div className="absolute inset-0 [&>*]:pointer-events-auto">
          {y !== null && (
            <>
              {/* The level itself — the line that becomes the order. */}
              <div
                className="absolute left-0 right-0 h-px pointer-events-none"
                style={{ top: y, backgroundColor: color, opacity: 0.9 }}
              />
              <div
                className="absolute right-0 -translate-y-1/2 px-1 py-px rounded text-[10px] font-semibold text-black pointer-events-none tabular-nums"
                style={{ top: y, backgroundColor: color }}
              >
                {price.toFixed(digits)}
              </div>
            </>
          )}

          {/* The sight — which candle, and which minute of it. */}
          {x !== null && (
            <>
              <div
                className="absolute top-0 bottom-0 w-px pointer-events-none"
                style={{ left: x, backgroundColor: color, opacity: 0.25 }}
              />
              <div
                className="absolute -translate-x-1/2 px-1 py-px rounded text-[9px] font-medium text-black whitespace-nowrap pointer-events-none tabular-nums"
                style={{ left: x, top: 4, backgroundColor: color, opacity: 0.9 }}
              >
                {stampMinute(time * 1000)}
              </div>
            </>
          )}

          {/* The handle. Small dot, 44px target, as everywhere else. */}
          {x !== null && y !== null && (
            <div
              role="slider"
              aria-label={`${label} level`}
              aria-valuenow={price}
              tabIndex={0}
              onPointerDown={(e) => {
                e.preventDefault();
                dragging.current = true;
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center cursor-grab active:cursor-grabbing"
              style={{ left: x, top: y, touchAction: 'none' }}
            >
              <span className="block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
            </div>
          )}
        </div>
      </div>

      <div className="absolute left-2 right-2 bottom-2 z-40 rounded-[12px] bg-surface/95 border border-white/10 backdrop-blur px-3 py-2.5">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[12px] font-semibold tracking-wide" style={{ color }}>
            {label}
          </span>
          <span className="text-[11px] text-muted tabular-nums">
            {price.toFixed(digits)} · {stampMinute(time * 1000)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="flex-1 h-[36px] rounded-[10px] bg-surface-2 text-white text-[15px]"
          >
            Cancel
          </button>
          <button
            onClick={() => onSet(field, price)}
            className="flex-1 h-[36px] rounded-[10px] bg-accent text-white text-[15px] font-semibold"
          >
            Set
          </button>
        </div>
      </div>
    </>
  );
}
