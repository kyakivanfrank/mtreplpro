import React from 'react';
import Section from '@/components/settings/fields/Section';
import ChevronRightIcon from '@/components/icons/ChevronRight';

/** The way into the chart settings, which open as a sheet over this page. */
export default function ChartSection({ onOpen }: { onOpen: () => void }) {
  return (
    <Section title="Chart" footer="Grid, bid price line and the chart's colours. Changes show on the chart straight away.">
      <button onClick={onOpen} className="flex w-full items-center justify-between py-2 min-h-[48px] text-left">
        <span className="text-white text-[17px]">Chart settings</span>
        <ChevronRightIcon />
      </button>
    </Section>
  );
}
