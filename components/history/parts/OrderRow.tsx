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
    <div className="flex flex-col px-1.5 py-2.5">
      <div className="flex justify-between items-center mb-1">
        <div className="flex items-center gap-1.5">
          <span className="symbol-condensed font-semibold text-[16px] leading-none tracking-tight">{symbol}</span>
          <span className={`text-[15px] leading-none ${side}`}>{order.kind}</span>
          <span className={`text-[15px] leading-none ${side}`}>{order.volume.toFixed(2)}</span>
        </div>
        <span className={`text-[13px] leading-none ${order.outcome === 'filled' ? 'text-accent' : 'text-muted'}`}>
          {order.outcome}
        </span>
      </div>
      <div className="flex justify-between items-center text-muted text-[13px]">
        <span className="tabular-nums">{order.price.toFixed(digits)}</span>
        <span>{stampSecond(order.settledTime)}</span>
      </div>
    </div>
  );
}
