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
    <div className="flex flex-col items-end whitespace-nowrap">
      <div className={`mt5-cond flex items-baseline ${cell.color}`}>
        <span className="text-[18px]">{cell.prefix}</span>
        <span className="text-[31px] leading-none">{cell.big}</span>
        <span className="text-[14px] relative -top-[13px]">{cell.sup}</span>
      </div>
      <div className="text-[13.5px] leading-[20px] text-quiet mt-0.5">{footer}</div>
    </div>
  );
}
