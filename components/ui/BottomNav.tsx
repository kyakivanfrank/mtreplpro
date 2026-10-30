'use client';

import React, { useEffect } from 'react';
import QuotesIcon from '@/components/icons/Quotes';
import TradeIcon from '@/components/icons/Trade';
import HistoryIcon from '@/components/icons/History';
import SettingsIcon from '@/components/icons/Settings';
import ChartsIcon from '@/components/icons/Charts';
import SlidingPill from '@/components/ui/SlidingPill';
import { useSlidingPill } from '@/components/ui/useSlidingPill';
import { PROFIT_DOWN, profitColor, useOpenProfit } from '@/lib/trading/profit';

const navItems = [
  { label: 'Quotes', id: 'quotes', Icon: QuotesIcon },
  { label: 'Chart', id: 'chart', Icon: ChartsIcon },
  { label: 'Trade', id: 'trade', Icon: TradeIcon },
  { label: 'History', id: 'history', Icon: HistoryIcon },
  { label: 'Settings', id: 'settings', Icon: SettingsIcon },
];

interface BottomNavProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

/** One tab's face: icon over caption. Shared by the bar and by the lens's magnified copy. */
function ItemFace({ Icon, label }: { Icon: (typeof navItems)[number]['Icon']; label: string }) {
  return (
    <>
      <Icon className="h-5 w-5" strokeWidth={2} />
      <span className="floating-nav-caption">{label}</span>
    </>
  );
}

const ITEM_CLASS = 'floating-nav-item relative z-10 flex h-full flex-1 flex-col items-center justify-center gap-[5px]';

/**
 * The floating tab bar, measured off the real terminal (see docs/MT5_PARITY.md).
 *
 * The pill is 1.3x an item's slot, inset 4px from the bar and held inside its ends — so it always
 * contains the whole icon and caption, "Settings" included. Changing tab swells the bar and turns
 * the pill into a moving lens over a magnified copy of the bar, then settles it back to dark.
 */
export default function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  const activeIndex = navItems.findIndex((item) => item.id === activeTab);
  const { trackRef, itemRefs, surfaceRef, pill, trackWidth, settled, hop } = useSlidingPill(activeIndex, {
    grow: 1.3,
    inset: 4,
  });

  // Selected, the Trade tab takes the book's colour: red while the open total is a loss, as on the
  // real terminal. Unselected it stays white like the rest -- a tint there read as a second
  // selection.
  const openProfit = useOpenProfit();
  const losing = profitColor(openProfit) === PROFIT_DOWN;
  // A class, not an inline colour: globals.css paints it in Display P3 like the rest of the red.
  const itemClass = (index: number) =>
    `${ITEM_CLASS} ${index === activeIndex ? 'active' : ''} ${
      index === activeIndex && navItems[index].id === 'trade' && losing ? 'is-losing' : ''
    }`;

  // The bar's swell, restarted on every hop.
  useEffect(() => {
    const bar = trackRef.current;
    if (!bar || hop === 0) return;
    bar.classList.remove('is-hopping');
    void bar.offsetWidth;
    bar.classList.add('is-hopping');
    const done = () => bar.classList.remove('is-hopping');
    bar.addEventListener('animationend', done, { once: true });
    return () => bar.removeEventListener('animationend', done);
  }, [hop, trackRef]);

  const lens = (
    <div className="flex h-full w-full px-[4%]">
      {navItems.map((item, index) => (
        <div key={item.id} className={itemClass(index)}>
          <ItemFace Icon={item.Icon} label={item.label} />
        </div>
      ))}
    </div>
  );

  return (
    /*
      `pointer-events-none` on the footer, `auto` on the bar inside it: the footer is a full-width
      fixed box, and the margins around the bar must not swallow touches meant for the screen
      underneath (the chart's time axis sits there).
    */
    <footer className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-[var(--nav-side)] pb-[var(--nav-gap-bottom)] flex justify-center">
      <div
        ref={trackRef}
        className="floating-nav pointer-events-auto relative flex w-full items-stretch rounded-full px-[4%] font-sans"
        style={{ height: 'var(--nav-bar-height)' }}
      >
        <SlidingPill pill={pill} settled={settled} surfaceRef={surfaceRef} trackWidth={trackWidth} lens={lens} />

        {navItems.map((item, index) => (
          <button
            key={item.id}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            onClick={() => onTabChange(item.id)}
            aria-current={index === activeIndex ? 'page' : undefined}
            className={itemClass(index)}
          >
            <ItemFace Icon={item.Icon} label={item.label} />
          </button>
        ))}
      </div>
    </footer>
  );
}
