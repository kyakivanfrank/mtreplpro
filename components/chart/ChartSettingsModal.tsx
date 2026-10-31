'use client';

import React, { useEffect, useState } from 'react';
import Portal from '@/components/ui/Portal';
import Switch from '@/components/ui/Switch';
import Section from '@/components/settings/fields/Section';
import { IN_EASE, IN_MS, OUT_EASE, OUT_MS } from '@/components/ui/CenterDialog';
import { DEFAULT_CHART_SETTINGS, type ChartSettings } from '@/components/chart/chartConfig';
import { setChartSettings, useChartSettings } from '@/components/chart/useChartSettings';

type ColorKey = keyof ChartSettings['colors'];

/** In the terminal's order: the canvas first, then the candles, then the lines over them. */
const COLOR_ROWS: { key: ColorKey; label: string }[] = [
  { key: 'background', label: 'Background' },
  { key: 'foreground', label: 'Foreground' },
  { key: 'grid', label: 'Grid' },
  { key: 'bull', label: 'Bull candle' },
  { key: 'bear', label: 'Bear candle' },
  { key: 'bid', label: 'Bid price line' },
];

const ROW = 'flex items-center py-2 min-h-[48px] border-b border-hairline last:border-b-0';

type Phase = 'hidden' | 'enter' | 'shown' | 'leave';

/**
 * The chart's settings: what is drawn, and in which colours.
 *
 * A sheet that rises over the account Settings page — a sheet on top of a sheet, and the only
 * way in. Above that page's layer (70) and below the login wall (90).
 *
 * Changes apply as they are made, so there is a Done and no Save. Each swatch is the native
 * colour picker stretched invisibly over the swatch, so iOS shows its own picker.
 *
 * The phase machine is ActionSheet's: closing has to outlive `open` so the sheet can slide down.
 */
export default function ChartSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useChartSettings();
  const [phase, setPhase] = useState<Phase>(open ? 'shown' : 'hidden');

  useEffect(() => {
    if (open) {
      setPhase('enter');
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setPhase('shown'));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }
    setPhase((current) => (current === 'hidden' ? 'hidden' : 'leave'));
    const done = setTimeout(() => setPhase('hidden'), OUT_MS);
    return () => clearTimeout(done);
  }, [open]);

  if (phase === 'hidden') return null;

  const visible = phase === 'shown';
  const leaving = phase === 'leave';
  const transition = visible ? `${IN_MS}ms ${IN_EASE}` : `${OUT_MS}ms ${OUT_EASE}`;

  const update = (patch: Partial<ChartSettings>) => setChartSettings({ ...settings, ...patch });
  const setColor = (key: ColorKey, value: string) =>
    update({ colors: { ...settings.colors, [key]: value.toLowerCase() } });

  return (
    <Portal>
      <div
        className={`fixed inset-0 z-[80] flex flex-col justify-end ${leaving ? 'pointer-events-none' : ''}`}
        role="dialog"
        aria-label="Chart settings"
      >
        <div
          className="absolute inset-0 bg-black/50"
          style={{ opacity: visible ? 1 : 0, transition: `opacity ${transition}` }}
          onClick={onClose}
        />

        <div
          className="relative flex max-h-[88%] flex-col rounded-t-[20px] bg-[#111113] text-white font-sans"
          style={{
            transform: visible ? 'translate3d(0, 0, 0)' : 'translate3d(0, 100%, 0)',
            transition: `transform ${transition}`,
          }}
        >
          <div className="mx-auto mt-[6px] h-[5px] w-[36px] shrink-0 rounded-full bg-[#5C6577]/40" />

          <div className="relative flex shrink-0 items-center justify-end px-4 pt-2 pb-3">
            <div className="absolute left-1/2 -translate-x-1/2 font-semibold text-[17px]">Chart</div>
            <button onClick={onClose} className="text-accent text-[17px] font-semibold">Done</button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-[calc(1.5rem+var(--safe-bottom))] space-y-6">
            <Section title="Display">
              <div className={ROW}>
                <div className="flex-1 text-[17px]">Show grid</div>
                <Switch checked={settings.grid} onChange={(grid) => update({ grid })} label="Show grid" />
              </div>
              <div className={ROW}>
                <div className="flex-1 text-[17px]">Show bid price line</div>
                <Switch
                  checked={settings.bidLine}
                  onChange={(bidLine) => update({ bidLine })}
                  label="Show bid price line"
                />
              </div>
            </Section>

            <Section title="Colors">
              {COLOR_ROWS.map(({ key, label }) => (
                <label key={key} className={`${ROW} cursor-pointer`}>
                  <span className="flex-1 text-[17px]">{label}</span>
                  <span
                    className="relative h-[26px] w-[44px] rounded-[6px] border border-white/25"
                    style={{ backgroundColor: settings.colors[key] }}
                  >
                    <input
                      type="color"
                      value={settings.colors[key]}
                      onChange={(event) => setColor(key, event.target.value)}
                      aria-label={label}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                  </span>
                </label>
              ))}
            </Section>

            <Section title="Defaults">
              <button
                onClick={() => setChartSettings(DEFAULT_CHART_SETTINGS)}
                className={`${ROW} w-full text-left text-[17px] text-danger`}
              >
                Reset to defaults
              </button>
            </Section>
          </div>
        </div>
      </div>
    </Portal>
  );
}
