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

  // Selection is the terminal's blue corner flag, not a row tint.
  return (
    <div
      onClick={handleClick}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={(e) => e.preventDefault()}
      style={{ touchAction: 'pan-y', WebkitTouchCallout: 'none', userSelect: 'none' }}
      className="relative flex justify-between items-center py-[7px] px-3 cursor-pointer transition-colors active:bg-white/5"
    >
      {selected && (
        <span
          aria-hidden
          className="absolute left-0 top-0 w-[10px] h-[10px] bg-accent"
          style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}
        />
      )}

      {/* Left Column */}
      <div className="flex flex-col flex-1 min-w-[100px]">
        <div className="flex items-center gap-[5px] text-[13.5px] leading-[20px]">
          <span className="text-quiet">{pts}</span>
          <span className={changeColor}>{pct}</span>
        </div>
        <div className="mt5-cond text-[18px] leading-[22px] text-white">{symbol}</div>
        <div className="flex items-center gap-1 text-[14px] leading-[20px] text-quiet">
          <span>{time}</span>
          <SpreadIcon />
          <span>{spread}</span>
        </div>
      </div>

      {/* Right Columns (Bid / Ask) */}
      <div className="flex gap-[18px] text-right">
        <PriceColumn cell={bid} footer={`L: ${low}`} />
        <PriceColumn cell={ask} footer={`H: ${high}`} />
      </div>
    </div>
  );
}
