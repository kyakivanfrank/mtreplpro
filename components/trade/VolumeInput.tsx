'use client';

import React, { useEffect, useState } from 'react';
import { normalizeVolume, volumeSpec } from '@/lib/trading/math';

/**
 * The lot field, with MT5's stepper either side of it.
 *
 * Typing is deliberately unconstrained while the field has focus — a user reaching for "0.25"
 * has to pass through "0." and "0.2", and snapping those to the nearest valid lot as they go
 * makes the field impossible to type into. The draft is kept as raw text and only normalized
 * on blur or when the steppers are used.
 *
 * Everything about what counts as a valid lot comes from the instrument. A tenth is one nudge
 * on Litecoin and ten on gold; XRP starts at a whole lot and cannot be fractioned at all. The
 * field used to step every symbol by 0.01 and print every symbol to two decimals, which put
 * two digits on XRP that no press could ever change.
 */
interface VolumeInputProps {
  value: number;
  onChange: (volume: number) => void;
  /** Whose lot rules apply — min, max, step and the decimals all come from here. */
  symbol: string;
  /** Chevrons point up/down on the chart bar and left/right in the ticket. */
  className?: string;
  inputClassName?: string;
}

export default function VolumeInput({ value, onChange, symbol, className = '', inputClassName = '' }: VolumeInputProps) {
  const { min, max, step, digits } = volumeSpec(symbol);
  const [draft, setDraft] = useState(value.toFixed(digits));

  // Follow the value when it changes from outside — a reset, the stepper, or the instrument
  // itself changing under it, which can move both the number and how many decimals it wants.
  useEffect(() => {
    setDraft(value.toFixed(digits));
  }, [value, digits]);

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    const next = Number.isFinite(parsed) ? normalizeVolume(parsed, symbol) : min;
    onChange(next);
    setDraft(next.toFixed(digits));
  };

  const nudge = (direction: 1 | -1) => {
    onChange(normalizeVolume(value + direction * step, symbol));
  };

  return (
    <div className={`flex items-center justify-between ${className}`}>
      <button
        type="button"
        onClick={() => nudge(-1)}
        disabled={value <= min}
        aria-label="Decrease volume"
        className="text-muted p-1 -ml-2 disabled:opacity-30"
      >
        <svg width="12" height="8" viewBox="0 0 12 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 1L6 6L11 1" />
        </svg>
      </button>

      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ''))}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        // Brings up the numeric pad on iOS without rejecting the decimal point.
        inputMode="decimal"
        aria-label="Volume in lots"
        className={`bg-transparent text-white text-[16px] font-medium leading-none text-center outline-none tabular-nums w-[64px] ${inputClassName}`}
      />

      <button
        type="button"
        onClick={() => nudge(1)}
        disabled={value >= max}
        aria-label="Increase volume"
        className="text-muted p-1 -mr-2 disabled:opacity-30"
      >
        <svg width="12" height="8" viewBox="0 0 12 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 7L6 2L11 7" />
        </svg>
      </button>
    </div>
  );
}
