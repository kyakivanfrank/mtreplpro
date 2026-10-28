import React from 'react';
import type { Position } from '@/lib/trading/types';
import { sideTone, resultTone } from '@/components/ui/tone';
import type { PositionView } from '@/components/trade/positionView';

/**
 * A position row: two lines, nothing else. It used to expand in place, which shoved every row
 * below it down the screen. Tapping now raises a sheet instead, so the list stays a list.
 */
export default function PositionItem({
  position,
  view,
  onOpen,
}: {
  position: Position;
  view: PositionView;
  onOpen: () => void;
}) {
  const side = sideTone(position.type === 'buy');
  const tone = resultTone(view.isProfit);

  return (
    <button onClick={onOpen} className="flex flex-col px-1.5 text-left w-full">
      <div className="flex justify-between items-center mb-2.5 w-full">
        <div className="flex items-center gap-1.5">
          <span className="symbol-condensed font-semibold text-[16px] leading-none tracking-tight">{view.symbol}</span>
          <span className={`text-[15px] symbol-condensed font-bold leading-none ${side}`}>{position.type}</span>
          <span className={`text-[15px] symbol-condensed font-bold  leading-none ${side}`}>{position.volume.toFixed(2)}</span>
        </div>
        <span className={`font-outfit font-semibold text-[22px] leading-none ${tone}`}>{view.profit}</span>
      </div>
      <div className="flex justify-between items-center font-inter text-muted text-[14px] w-full">
        <span>{view.openPrice} <span className="text-faint">→</span> {view.currentPrice}</span>
        {position.swap !== 0 && <span>swap {position.swap.toFixed(2)}</span>}
      </div>
    </button>
  );
}
