import React from 'react';
import type { Position } from '@/lib/trading/types';
import { sideTone, resultTone } from '@/components/ui/tone';
import type { PositionView } from '@/components/trade/positionView';

/**
 * A position row, as the terminal draws it: symbol, side and volume over the open → current
 * prices, with the P/L on the right. Tapping raises a sheet rather than expanding in place.
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
    <button onClick={onOpen} className="flex flex-col px-4 py-1 text-left w-full active:bg-white/5">
      <div className="flex justify-between items-center w-full h-[26px]">
        <span className="mt5-cond text-[17px] leading-none">
          {view.symbol} <span className={side}>{position.type} {position.volume.toFixed(2)}</span>
        </span>
        <span className={`mt5-cond text-[20px] leading-none ${tone}`}>{view.profit}</span>
      </div>
      <div className="mt5-price-line flex justify-between items-center text-quiet text-[17px] leading-[24px] w-full">
        <span>{view.openPrice} → {view.currentPrice}</span>
        {position.swap !== 0 && <span>swap {position.swap.toFixed(2)}</span>}
      </div>
    </button>
  );
}
