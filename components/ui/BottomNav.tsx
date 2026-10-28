'use client';

import React from 'react';
import QuotesIcon from '@/components/icons/Quotes';
import TradeIcon from '@/components/icons/Trade';
import HistoryIcon from '@/components/icons/History';
import SettingsIcon from '@/components/icons/Settings';
import ChartsIcon from '@/components/icons/Charts';
import { profitColor, useOpenProfit } from '@/lib/trading/profit';
import SlidingPill from '@/components/ui/SlidingPill';
import { useSlidingPill } from '@/components/ui/useSlidingPill';

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

/*
 * The selection pill is one shared element that slides between tabs rather than a
 * background that blinks off one button and on to the next. Mid-flight it lifts:
 * scales up a touch, blurs harder and picks up a shadow, so it reads as the glass
 * peeling off the bar, travelling, and settling back flush into the next slot --
 * the iOS trick of animating the *object* instead of cross-fading two states.
 */
export default function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  // The Trade tab carries the account's open profit as its own colour, so the book's state is
  // legible from any screen without switching to it.
  const openProfit = useOpenProfit();

  const activeIndex = navItems.findIndex((item) => item.id === activeTab);
  const { trackRef, itemRefs, surfaceRef, pill, settled } = useSlidingPill(activeIndex);

  return (
    /*
      `pointer-events-none` on the footer, `auto` on the bar inside it.

      The footer is a full-width fixed box at z-50 whose visible part is only the pill in the
      middle of it: 20px of padding above, the home-indicator inset below, 20px either side.
      All of that was still catching touches, and screens are allowed to run underneath it --
      the chart deliberately reserves the pill and the bottom gap but *not* `--nav-gap-top`,
      because reserving it left a band of dead black between the time labels and the pill. So
      the chart's time axis sat under that transparent strip and could not be pressed or
      dragged at all, while pinching the candles higher up worked fine.

      Nothing is lost by letting the strip through. The bar itself still takes its own taps,
      and a fixed element blocking whatever happens to be behind its padding was never doing
      any work -- it just made the bottom inch of every screen quietly inert.
    */
    <footer className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-5 pt-[var(--nav-gap-top)] pb-[var(--nav-gap-bottom)] flex justify-center">
      <div
        ref={trackRef}
        className="
          floating-nav pointer-events-auto
          relative flex w-full items-center justify-around
          rounded-full p-[1px] font-sans
        "
      >
        <SlidingPill trackRef={trackRef} itemRefs={itemRefs} surfaceRef={surfaceRef} pill={pill} settled={settled} />

        {navItems.map((item, index) => {
          const isActive = activeTab === item.id;

          // Only while it is *not* the current tab. Active is blue for every tab, and a Trade
          // tab tinted red or white in that state would read as the selection having failed
          // rather than as a loss. Selection outranks status; the header on the screen the
          // user just landed on carries the number anyway.
          const tint = item.id === 'trade' && !isActive ? profitColor(openProfit) : undefined;

          return (
            <button
              key={item.id}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              onClick={() => onTabChange(item.id)}
              style={tint ? { color: tint } : undefined}
              className={`
                floating-nav-item
                relative z-10 flex h-14 flex-1 flex-col items-center justify-center
                gap-0.5 rounded-full m-0.5
                ${isActive ? 'active' : ''}
              `}
            >
              <item.Icon className="h-8 w-5" strokeWidth={2} />
              <span className="floating-nav-caption">{item.label}</span>
            </button>
          );
        })}
      </div>
    </footer>
  );
}
