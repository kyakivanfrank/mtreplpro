import React from 'react';
import SettingsItem from '@/components/settings/SettingsItem';
import RowIcon from '@/components/settings/parts/RowIcon';
import MenuButton from '@/components/settings/parts/MenuButton';
import type { SettingsRow } from '@/components/settings/settingsRows';

/** A run of settings rows. The last one drops its divider unless the card asks to keep it. */
export default function SettingsRows({
  rows,
  badgeCount,
  keepLastDivider = false,
  onSelect,
}: {
  rows: SettingsRow[];
  badgeCount: number | null;
  keepLastDivider?: boolean;
  /** Only rows the caller recognises get a handler; the rest are inert, as they always were. */
  onSelect?: (key: string) => (() => void) | undefined;
}) {
  return (
    <>
      {rows.map((row, index) => (
        <SettingsItem
          key={row.key}
          icon={<RowIcon row={row} badgeCount={badgeCount} />}
          title={row.title}
          subtitle={row.subtitle}
          showChevron={row.showChevron ?? true}
          hasDivider={keepLastDivider || index < rows.length - 1}
          rightElement={row.menuButton ? <MenuButton /> : undefined}
          onClick={onSelect?.(row.key)}
        />
      ))}
    </>
  );
}
