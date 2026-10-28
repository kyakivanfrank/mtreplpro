import React from 'react';

/**
 * A whole-number setting with a range, as a stepper.
 *
 * A stepper rather than a text field because every one of these is a small integer inside known
 * bounds — a text box invites `900000` and then has to explain why it became `900`. The buttons
 * cannot produce an invalid value, so there is no error state to design.
 *
 * `disabled` dims the row and stops both the buttons and the field: settings for a mode that is
 * off are not decisions the user is being asked to make yet.
 */
export default function StepperRow({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  disabled = false,
  last = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Unit shown after the number — "s" for seconds, "lots". */
  suffix?: string;
  disabled?: boolean;
  last?: boolean;
}) {
  const safe = Number.isFinite(value) ? value : min;
  const nudge = (direction: 1 | -1) => {
    // Rounded through the step so a stored value off the grid is pulled onto it rather than
    // carried along by every press.
    const next = Math.round((safe + direction * step) / step) * step;
    onChange(Math.min(max, Math.max(min, Number(next.toFixed(2)))));
  };

  return (
    <div
      className={`flex items-center py-2 min-h-[48px] ${last ? '' : 'border-b border-hairline'} ${
        disabled ? 'opacity-40' : ''
      }`}
    >
      <span className="text-white text-[17px] flex-1">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          disabled={disabled || safe <= min}
          onClick={() => nudge(-1)}
          className="text-accent w-7 text-[22px] leading-none disabled:opacity-30"
        >
          −
        </button>
        <span className="text-muted text-[17px] tabular-nums min-w-[64px] text-right">
          {step < 1 ? safe.toFixed(2) : safe}
          {suffix ? ` ${suffix}` : ''}
        </span>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          disabled={disabled || safe >= max}
          onClick={() => nudge(1)}
          className="text-accent w-7 text-[22px] leading-none disabled:opacity-30"
        >
          +
        </button>
      </div>
    </div>
  );
}
