import React from 'react';
import { ICON_DEFAULTS, type SettingsRow } from '@/components/settings/settingsRows';

/** A row's glyph, in its coloured tile — or bare, for a row with no `bgClass`. */
export default function RowIcon({ row, badgeCount }: { row: SettingsRow; badgeCount: number | null }) {
  const { size, padding, tint, boxClass } = { ...ICON_DEFAULTS, ...row.icon };
  const glyph = <row.Icon className={`${size} ${tint}`} />;

  if (!row.bgClass) {
    return glyph;
  }

  return (
    <div
      className={`w-8 h-8 rounded-[8px] flex items-center justify-center relative ${row.bgClass} ${padding} ${boxClass}`}
    >
      {glyph}
      {row.badge && badgeCount !== null && badgeCount > 0 && (
        <div className="absolute -top-1.5 -right-1.5 bg-danger text-white text-[10px] font-semibold min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full border border-surface">
          {badgeCount}
        </div>
      )}
    </div>
  );
}
