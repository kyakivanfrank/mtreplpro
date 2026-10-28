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
    <div className="flex flex-col border-b border-surface-2">
      <button onClick={onToggle} className="flex flex-col px-4 py-3 text-left w-full">
        <div className="flex justify-between items-center mb-1 w-full">
          <div className="flex items-center gap-1.5">
            <span className="symbol-condensed font-semibold text-[16px] leading-none tracking-tight">{symbol}</span>
            <span className={`text-[15px] leading-none ${side}`}>{order.kind}</span>
            <span className={`text-[15px] leading-none ${side}`}>{order.volume.toFixed(2)}</span>
          </div>
          <span className="text-muted text-[15px] leading-none tabular-nums">{order.price.toFixed(digits)}</span>
        </div>
        <div className="text-muted text-[14px]">waiting</div>
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
