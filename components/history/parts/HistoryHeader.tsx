import React from 'react';
import FilterIcon from '@/components/icons/Filter';
import ClockIcon from '@/components/icons/Clock';
import SegmentedControl from '@/components/ui/SegmentedControl';
import type { Tab } from '@/components/history/tabs';
import { TABS } from '@/components/history/tabs';

/* Three exports, not one component: `ViewLayout` takes the slots as separate props. */

/** Not yet wired — the header is a three-part bar and the terminal has a filter here. */
export function HistoryHeaderLeft() {
  return (
    <button
      aria-label="Filter history"
      className="glass-control w-[44px] h-[44px] rounded-full flex items-center justify-center cursor-pointer"
    >
      <FilterIcon className="w-[24px] h-[24px] text-white" />
    </button>
  );
}

/**
 * `px-3` on the tabs rather than `px-4`, and it is load-bearing.
 *
 * The centre group is absolutely positioned, so it slides under the side buttons rather than
 * pushing them. At `px-4` the strip plus two 52px circles plus the header's margins comes to
 * 384px — six pixels clear on a 390pt phone, overlapping on a 375pt one.
 */
export function HistoryHeaderCenter({
  tab,
  onChange,
}: {
  tab: Tab;
  onChange: (tab: Tab) => void;
}) {
  return <SegmentedControl tabs={TABS} value={tab} onChange={onChange} />;
}

/** Not yet wired, like the filter. */
export function HistoryHeaderRight() {
  return (
    <button
      aria-label="History period"
      className="glass-control w-[44px] h-[44px] rounded-full flex items-center justify-center cursor-pointer"
    >
      <ClockIcon />
    </button>
  );
}
