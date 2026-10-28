import React from 'react';
import DotsHorizontalIcon from '@/components/icons/DotsHorizontal';

/**
 * The Positions heading and its bulk-actions button. Rendered only while something is open —
 * "close all" over nothing to close is worse than no heading at all.
 *
 * Sticks at the header's height using the custom property `ViewLayout` publishes, and carries
 * the header's material so the two read as one bar when rows slide under it.
 */
export default function PositionsHeading({ onBulk }: { onBulk: () => void }) {
  return (
    <div className="sticky-bar sticky z-[999999] top-0 ">
      <div className="flex justify-between bg-[#070707] items-center px-1.5 py-[2px]">
        <span className="font-semibold text-[15px]">Positions</span>
        <button onClick={onBulk} aria-label="Bulk operations" className="text-muted">
          <DotsHorizontalIcon />
        </button>
      </div>
    </div>
  );
}
