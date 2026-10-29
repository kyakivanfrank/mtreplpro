import React from 'react';
import type { PendingOrder } from '@/lib/trading/types';
import { findInstrument } from '@/lib/instruments';
import { sideTone } from '@/components/ui/tone';

/** A pending order. Same tap-to-reveal, but the action is Cancel rather than Close. */
export default function OrderItem({
  order,
  symbol,
  expanded,
  onToggle,
  onCancel,
}: {
  order: PendingOrder;
  symbol: string;
  expanded: boolean;
  onToggle: () => void;
  onCancel: () => void;
}) {
  const digits = findInstrument(order.symbol)?.digits ?? 2;
  const isBuy = order.kind.startsWith('buy');
  const side = sideTone(isBuy);

  return (
    <div className="flex flex-col">
      <button onClick={onToggle} className="flex flex-col px-4 py-1 text-left w-full active:bg-white/5">
        <div className="flex justify-between items-center w-full h-[26px]">
          <span className="mt5-cond text-[17px] leading-none">
            {symbol} <span className={side}>{order.kind} {order.volume.toFixed(2)}</span>
          </span>
          <span className="mt5-cond text-[17px] leading-none text-white">placed</span>
        </div>
        <div className="text-quiet text-[17px] leading-[24px]">
          {order.volume.toFixed(2)} / 0.00 at {order.price.toFixed(digits)}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-3">
          <button
            onClick={onCancel}
            className="w-full h-[36px] rounded-[10px] bg-surface-3 text-white text-[14px] font-semibold"
          >
            Cancel order
          </button>
        </div>
      )}
    </div>
  );
}
