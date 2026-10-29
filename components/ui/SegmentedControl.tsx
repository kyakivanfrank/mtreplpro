'use client';

import React from 'react';
import SlidingPill from '@/components/ui/SlidingPill';
import { useSlidingPill } from '@/components/ui/useSlidingPill';

/**
 * A row of text tabs with the selection pill sliding between them — the tab bar's mechanism at
 * segmented-control scale. As on the terminal's History header: SF Pro 17pt, the selected label
 * stays white and only the dark pill marks it.
 */
export default function SegmentedControl<T extends string>({
  tabs,
  value,
  onChange,
  className = '',
}: {
  tabs: readonly T[];
  value: T;
  onChange: (tab: T) => void;
  className?: string;
}) {
  const pillState = useSlidingPill(tabs.indexOf(value), { grow: 1.08, inset: 4 });

  return (
    <div ref={pillState.trackRef} className={`floating-nav relative flex h-[50px] rounded-full px-[4px] ${className}`}>
      <SlidingPill
        pill={pillState.pill}
        settled={pillState.settled}
        surfaceRef={pillState.surfaceRef}
        trackWidth={pillState.trackWidth}
      />

      {tabs.map((name, index) => (
        <button
          key={name}
          ref={(node) => {
            pillState.itemRefs.current[index] = node;
          }}
          onClick={() => onChange(name)}
          className={`floating-nav-item is-plain relative z-10 flex h-full items-center justify-center px-[13px] text-[17px] leading-none ${
            value === name ? 'active' : ''
          }`}
        >
          {name}
        </button>
      ))}
    </div>
  );
}
