'use client';

import React from 'react';
import SlidingPill from '@/components/ui/SlidingPill';
import { useSlidingPill } from '@/components/ui/useSlidingPill';

/**
 * A row of text tabs with the selection pill sliding between them — the bottom bar's mechanism
 * at segmented-control scale.
 *
 * `BottomNav` deliberately does not go through this: its items carry an icon, caption, `flex-1`
 * and per-tab tint, and folding those in would make this a nav bar rather than a control.
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
  const pillState = useSlidingPill(tabs.indexOf(value));

  return (
    <div
      ref={pillState.trackRef}
      className={`floating-nav relative flex rounded-full p-[4px] ${className}`}
    >
      <SlidingPill {...pillState} />

      {tabs.map((name, index) => (
        <button
          key={name}
          ref={(node) => {
            pillState.itemRefs.current[index] = node;
          }}
          onClick={() => onChange(name)}
          className={`
            floating-nav-item
            relative z-10 flex h-[44px] items-center justify-center
            rounded-full px-3 text-[14px] leading-none
            ${value === name ? 'active font-semibold' : 'font-medium'}
          `}
        >
          {name}
        </button>
      ))}
    </div>
  );
}
