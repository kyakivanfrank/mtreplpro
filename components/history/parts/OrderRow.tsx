import React from 'react';
import type { OrderRecord } from '@/lib/trading/types';
import { findInstrument } from '@/lib/instruments';
import { stampSecond } from '@/lib/timeFormat';
import { sideTone } from '@/components/ui/tone';

/** A settled order — filled, cancelled or expired. */
export default function OrderRow({ order, symbol }: { order: OrderRecord; symbol: string }) {
  const digits = findInstrument(order.symbol)?.digits ?? 2;
  const side = sideTone(order.kind.startsWith('buy'));

  return (
    <div className="flex flex-col px-4 py-[5px]">
      <div className="flex justify-between items-center h-[26px]">
        <span className="mt5-cond text-[17px] leading-none">
          {symbol} <span className={side}>{order.kind} {order.volume.toFixed(2)}</span>
        </span>
        <span className="mt5-cond text-[17px] leading-none text-white">{order.outcome}</span>
      </div>
      <div className="flex justify-between items-center text-quiet text-[14px] leading-[22px]">
        <span>{order.price.toFixed(digits)}</span>
        <span>{stampSecond(order.settledTime)}</span>
      </div>
    </div>
  );
}
