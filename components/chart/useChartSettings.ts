import { useSyncExternalStore } from 'react';
import { DEFAULT_CHART_SETTINGS, type ChartSettings } from '@/components/chart/chartConfig';
import { readSetting, STORAGE_KEYS, writeSetting } from '@/lib/storage';

/**
 * The chart's look, shared by the chart and the Settings page.
 *
 * One store rather than a `usePersistentState` in each, because both can be mounted at once and
 * a change made on the Settings page has to be on the chart behind it straight away.
 */
let current: ChartSettings | null = null;
const listeners = new Set<() => void>();

/** The first grid colour shipped, before it was measured against the real terminal. */
const UNMEASURED_GRID = '#3c3c3c';

function load(): ChartSettings {
  if (current) return current;
  const stored = readSetting<ChartSettings | null>(STORAGE_KEYS.chartSettings, null);
  // Merged, so a value saved before a field existed still loads.
  const merged: ChartSettings = stored
    ? { ...DEFAULT_CHART_SETTINGS, ...stored, colors: { ...DEFAULT_CHART_SETTINGS.colors, ...stored.colors } }
    : DEFAULT_CHART_SETTINGS;
  if (merged.colors.grid === UNMEASURED_GRID) {
    merged.colors = { ...merged.colors, grid: DEFAULT_CHART_SETTINGS.colors.grid };
  }
  current = merged;
  return merged;
}

export function setChartSettings(settings: ChartSettings): void {
  current = settings;
  writeSetting(STORAGE_KEYS.chartSettings, settings);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useChartSettings(): ChartSettings {
  return useSyncExternalStore(subscribe, load, () => DEFAULT_CHART_SETTINGS);
}
