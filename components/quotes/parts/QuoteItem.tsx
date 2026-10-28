import React, { useEffect, useRef } from 'react';
import SpreadIcon from '@/components/icons/Spread';
import PriceColumn from '@/components/quotes/parts/PriceColumn';
import type { QuoteItemProps } from '@/components/quotes/quoteItemProps';

/** Hold duration before a press counts as "change this symbol" rather than a tap. */
const LONG_PRESS_MS = 450;

/** A watchlist row: change on the left, bid and ask on the right. Tap opens the chart, hold swaps the symbol. */
export default function QuoteItem({
  pts,
  pct,
  symbol,
  time,
  spread,
  changeColor,
  bid,
  low,
  ask,
  high,
  selected,
  onClick,
  onLongPress,
}: QuoteItemProps & { selected?: boolean; onClick?: () => void; onLongPress?: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);

  const startPress = () => {
    if (!onLongPress) return;
    fired.current = false;
    timer.current = setTimeout(() => {
      fired.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  };

  const cancelPress = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => cancelPress, []);

  const handleClick = () => {
    // A completed long press already opened the picker; don't also jump to the chart.
    if (fired.current) {
      fired.current = false;
      return;
    }
    onClick?.();
  };

  // The selected tint sits just above the noise floor — legible if you look for it, invisible if you don't.
  return (
    <div
      onClick={handleClick}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'pan-y', WebkitTouchCallout: 'none', userSelect: 'none' }}
      className={`flex justify-between items-center py-2.5 -mx-4 px-4 cursor-pointer transition-colors ${selected ? 'bg-white/[0.012]' : 'active:bg-white/5'}`}
    >
      {/* Left Column */}
      <div className="flex flex-col flex-1 min-w-[100px]">
        <div className="flex items-center gap-2 text-[12px] font-semibold font-mono tracking-tighter">
          <span className="text-muted">{pts}</span>
          <span className={changeColor}>{pct}</span>
        </div>
        {/* Condensed in a span of its own rather than on this line box: as a flex item the div
            would blockify the class's `inline-block` away, and the shrink-to-fit width is the
            half of it that hands the space back. See `.symbol-condensed`. */}
        <div className="font-semibold text-[18px] text-white leading-tight mt-0.5 mb-1">
          <span className="symbol-condensed">{symbol}</span>
        </div>
        <div className="flex items-center gap-1 text-[12px] text-muted font-mono tracking-tighter">
          <span>{time}</span>
          <SpreadIcon />
          <span>{spread}</span>
        </div>
      </div>

      {/* Right Columns (Bid / Ask) */}
      <div className="flex gap-4 text-right">
        <PriceColumn cell={bid} footer={`L: ${low}`} />
        <PriceColumn cell={ask} footer={`H: ${high}`} />
      </div>
    </div>
  );
}
