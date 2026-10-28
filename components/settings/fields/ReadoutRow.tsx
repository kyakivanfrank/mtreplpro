import React from 'react';

/**
 * A label and a value the user cannot edit — the row this sheet uses twelve times over.
 *
 * It appeared in two sizes, and the difference is meaningful rather than accidental: `md` is a
 * row of the same rank as the editable ones around it (History, Stored, Durability), `sm` is
 * detail *about* the row above it (Equity, Leverage, Free margin). Both are kept.
 *
 * Some callers wrote the same layout as `justify-between` and others as `ml-auto` on the value.
 * With two children those render identically; this settles on one.
 */
export default function ReadoutRow({
  label,
  value,
  size = 'md',
  divider = 'bottom',
  valueClassName = '',
  tabular = true,
}: {
  label: string;
  value: React.ReactNode;
  /** `md` ranks with the editable rows; `sm` is detail under one. */
  size?: 'sm' | 'md';
  divider?: 'top' | 'bottom' | 'none';
  /** Overrides the value's colour, for a value that is itself a status. */
  valueClassName?: string;
  tabular?: boolean;
}) {
  const height = size === 'sm' ? 'min-h-[44px]' : 'min-h-[48px]';
  const labelText = size === 'sm' ? 'text-muted text-[15px]' : 'text-white text-[17px]';
  const valueText = size === 'sm' ? 'text-[15px]' : 'text-[17px]';
  const valueTone = valueClassName || (size === 'sm' ? 'text-white' : 'text-muted');

  const rule =
    divider === 'bottom'
      ? 'border-b border-hairline'
      : divider === 'top'
        ? 'border-t border-hairline'
        : '';

  return (
    <div className={`flex items-center justify-between py-2 ${height} ${rule}`}>
      <span className={labelText}>{label}</span>
      <span className={`${valueTone} ${valueText} ${tabular ? 'tabular-nums' : ''}`}>{value}</span>
    </div>
  );
}
