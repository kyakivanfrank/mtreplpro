import React from 'react';
import Section from '@/components/settings/fields/Section';
import ReadoutRow from '@/components/settings/fields/ReadoutRow';
import { formatBytes, type StorageStatus } from '@/lib/db';

/**
 * Reported, not chosen.
 *
 * This was an editable field with a destructive re-download behind it, and it could only ever
 * disagree with reality: the terminal publishes a fixed window and drops the far end of it every
 * cycle. The published number is the only one that means anything, so it is shown as a fact
 * about the feed rather than as a setting.
 */
export function MarketDataSection({
  publishedCandles,
  publishedDays,
  publishedCount,
  perSymbolBytes,
}: {
  publishedCandles: number;
  publishedDays: number;
  publishedCount: number;
  perSymbolBytes: number;
}) {
  return (
    <Section
      title="Market Data"
      footer={`Charts are drawn from downloaded 1-minute candles, never from a live stream. The terminal keeps the newest ${publishedCandles.toLocaleString()} candles of every instrument — a fixed amount of chart, so a pair that does not trade at weekends simply reaches further back to fill it — and this device mirrors that queue exactly. Only days whose candle count has actually changed are ever downloaded. About ${formatBytes(perSymbolBytes)} per symbol.`}
    >
      <ReadoutRow label="History" divider="none" value={`${publishedCandles.toLocaleString()} candles`} />
      <ReadoutRow label="Equivalent" divider="top" value={`~${publishedDays} trading days`} />
      <ReadoutRow label="Instruments" divider="top" value={publishedCount > 0 ? publishedCount : '—'} />
    </Section>
  );
}

/** What is on the device, and the one button that clears it. */
export function LocalDataSection({
  storage,
  confirmDelete,
  onReset,
}: {
  storage: StorageStatus;
  confirmDelete: boolean;
  onReset: () => void;
}) {
  return (
    <Section
      title="Local Data"
      footer={
        storage.persistent
          ? 'Settings, positions and downloaded candles are stored permanently on this device and are never removed automatically. Reset clears all of it and downloads the history again straight away.'
          : 'Stored on this device. The browser has not granted permanent storage, so data may be cleared if the device runs very low on space — installing the app to the home screen usually secures it. Reset clears everything and downloads the history again straight away.'
      }
    >
      <ReadoutRow label="Stored" tabular={false} value={formatBytes(storage.usage)} />
      <ReadoutRow
        label="Durability"
        tabular={false}
        valueClassName={storage.persistent ? 'text-accent' : 'text-muted'}
        value={storage.persistent ? 'Permanent' : 'Best effort'}
      />

      <button
        onClick={onReset}
        className="w-full flex items-center py-2 min-h-[48px] text-left text-danger text-[17px]"
      >
        {confirmDelete ? 'Tap again — clears the account and re-downloads' : 'Reset'}
      </button>
    </Section>
  );
}
