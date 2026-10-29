import React from 'react';
import DotsHorizontalIcon from '@/components/icons/DotsHorizontal';

/**
 * The Positions heading and its bulk-actions button. Rendered only while something is open —
 * "close all" over nothing to close is worse than no heading at all.
 *
 * Parks flush under the header once scrolled to, as the terminal's does.
 */
export default function PositionsHeading({ onBulk }: { onBulk: () => void }) {
  return (
    <div className="sticky-bar sticky z-20 top-0 flex justify-between items-center px-4 h-[30px]">
      <span className="mt5-cond text-[15px] leading-none">Positions</span>
      <button onClick={onBulk} aria-label="Bulk operations" className="text-[#6c6c6c] -mr-1 p-1">
        <DotsHorizontalIcon />
      </button>
    </div>
  );
}
