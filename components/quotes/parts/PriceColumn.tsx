import React from 'react';
import type { PriceCell } from '@/components/quotes/quoteItemProps';

/**
 * One price column — bid or ask — with its day extreme underneath.
 *
 * The two were written out separately in the row, identical but for which fields they read, so
 * the 28px/17px/14px baseline arrangement existed twice and had to be changed twice.
 */
export default function PriceColumn({ cell, footer }: { cell: PriceCell; footer: string }) {
  return (
    <div className="flex flex-col items-end min-w-[85px] whitespace-nowrap">
      <div className={`flex items-baseline ${cell.color} font-medium tracking-tighter`}>
        <span className="text-[17px]">{cell.prefix}</span>
        <span className="text-[28px] leading-none">{cell.big}</span>
        <span className="text-[14px] relative -top-[10px]">{cell.sup}</span>
      </div>
      <div className="text-[12px] text-muted mt-0.5 font-mono tracking-tighter">{footer}</div>
    </div>
  );
}
