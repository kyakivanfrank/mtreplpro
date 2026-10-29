import React from 'react';
import SettingsItem from '@/components/settings/SettingsItem';
import RowIcon from '@/components/settings/parts/RowIcon';
import type { SettingsRow } from '@/components/settings/settingsRows';

/** A run of settings rows. The last one in a card has no divider. */
export default function SettingsRows({
  rows,
  onSelect,
}: {
  rows: SettingsRow[];
  /** Only rows the caller recognises get a handler; the rest are inert, as they always were. */
  onSelect?: (key: string) => (() => void) | undefined;
}) {
  return (
    <>
      {rows.map((row, index) => (
        <SettingsItem
          key={row.key}
          icon={<RowIcon row={row} />}
          title={row.title}
          subtitle={row.subtitle}
          hasDivider={index < rows.length - 1}
          onClick={onSelect?.(row.key)}
        />
      ))}
    </>
  );
}
