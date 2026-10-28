import React from 'react';
import type { Deal } from '@/lib/trading/types';
import { findInstrument } from '@/lib/instruments';
import { groupedMoney } from '@/lib/money';
import { stampSecond } from '@/lib/timeFormat';
import { sideTone, resultTone } from '@/components/ui/tone';

/** A closed trade. `showTicket` is on in the Deals tab, where two deals can otherwise look alike. */
export default function DealItem({
  deal,
  symbol,
  showTicket,
}: {
  deal: Deal;
  symbol: string;
  showTicket: boolean;
}) {
  const digits = findInstrument(deal.symbol)?.digits ?? 2;
  const side = sideTone(deal.type === 'buy');

  return (
    <div className="flex flex-col px-1.5 py-2.5">
      <div className="flex justify-between items-center mb-1">
        <div className="flex items-center gap-1.5">
          <span className="symbol-condensed font-semibold text-[16px] leading-none tracking-tight">{symbol}</span>
          <span className={`text-[15px] leading-none ${side}`}>{deal.type}</span>
          <span className={`text-[15px] leading-none ${side}`}>{deal.volume.toFixed(2)}</span>

          {(deal.reason === 'sl' || deal.reason === 'tp') && (
            <span className="text-muted text-[11px] uppercase">{deal.reason}</span>
          )}
        </div>
        <span className={`font-outfit font-semibold text-[16px] leading-none ${resultTone(deal.profit >= 0)}`}>
          {groupedMoney(deal.profit)}
        </span>
      </div>
      <div className="flex justify-between items-center font-inter text-muted text-[13px]">
        <span>
          {showTicket && <span className="text-faint">#{deal.ticket} </span>}
          {deal.openPrice.toFixed(digits)} <span className="text-faint">→</span> {deal.closePrice.toFixed(digits)}
        </span>
        <span>{stampSecond(deal.closeTime)}</span>
      </div>
    </div>
  );
}
