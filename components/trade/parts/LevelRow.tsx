import React from 'react';
import CrosshairIcon from '@/components/icons/Crosshair';
import type { LevelField } from '@/components/chart/chartConfig';

/**
 * One price level on the ticket: a label, an optional "aim it at the chart" button, and a
 * nudgeable field. Price, Stop Loss and Take Profit are all this row.
 *
 * Nudges move by ten points, which is a visible step at every instrument's precision.
 */
export default function LevelRow({
  field,
  label,
  value,
  onChange,
  placeholder = 'not set',
  digits,
  point,
  fallbackPrice,
  onPickLevel,
}: {
  field: LevelField;
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  digits: number;
  point: number;
  /** Where a nudge starts from, and what the picker opens on, when the field is empty. */
  fallbackPrice: number | null;
  onPickLevel?: (field: LevelField, current: number | null) => void;
}) {
  const parse = (v: string): number | null => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  const step = 10 * point;

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-surface-2">
      <div className="flex items-center gap-2">
        <span className="text-white text-[16px]">{label}</span>
        {onPickLevel && (
          <button
            type="button"
            aria-label={`Pick ${label} on the chart`}
            onClick={() => onPickLevel(field, parse(value) ?? fallbackPrice)}
            className="text-accent w-6 h-6 flex items-center justify-center"
          >
            {/* A crosshair, because that is what it opens. */}
            <CrosshairIcon className="w-[15px] h-[15px]" />
          </button>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          onClick={() => {
            const current = parse(value);
            if (current !== null) onChange((current - step).toFixed(digits));
          }}
          className="text-muted w-6 text-[20px] leading-none"
        >
          −
        </button>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
          inputMode="decimal"
          placeholder={placeholder}
          className="bg-transparent text-white text-[16px] text-right outline-none tabular-nums w-[96px] placeholder-faint"
        />
        <button
          type="button"
          aria-label={`Increase ${label}`}
          onClick={() => {
            const current = parse(value);
            onChange(
              current !== null
                ? (current + step).toFixed(digits)
                : ((fallbackPrice ?? 0) + step).toFixed(digits)
            );
          }}
          className="text-muted w-6 text-[20px] leading-none"
        >
          +
        </button>
      </div>
    </div>
  );
}
