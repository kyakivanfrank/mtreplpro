import React from 'react';
import { ICON_DEFAULTS, type SettingsRow } from '@/components/settings/settingsRows';

/** A row's glyph in its 30pt coloured tile — or bare, for a row with no `bgClass`. */
export default function RowIcon({ row }: { row: SettingsRow }) {
  const { size, padding, tint, boxClass } = { ...ICON_DEFAULTS, ...row.icon };
  const glyph = <row.Icon className={`${size} ${tint}`} />;

  if (!row.bgClass) {
    return <div className="w-[30px] h-[30px] flex items-center justify-center">{glyph}</div>;
  }

  return (
    <div
      className={`w-[30px] h-[30px] rounded-[7px] flex items-center justify-center ${row.bgClass} ${padding} ${boxClass}`}
    >
      {glyph}
    </div>
  );
}
