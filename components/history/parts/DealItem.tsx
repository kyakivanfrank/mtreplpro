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
    <div className="flex flex-col px-4 py-1">
      <div className="flex justify-between items-center h-[26px]">
        <span className="mt5-cond text-[17px] leading-none">
          {symbol} <span className={side}>{deal.type} {deal.volume.toFixed(2)}</span>
          {(deal.reason === 'sl' || deal.reason === 'tp') && (
            <span className="text-quiet text-[13px] uppercase"> {deal.reason}</span>
          )}
        </span>
        <span className={`mt5-cond text-[17px] leading-none ${resultTone(deal.profit >= 0)}`}>
          {groupedMoney(deal.profit)}
        </span>
      </div>
      {/* Same size as the Trade tab's price line on the real terminal, not a smaller caption. */}
      <div className="mt5-price-line flex justify-between items-center text-quiet text-[14px] leading-[24px]">
        <span>
          {showTicket && <span>#{deal.ticket} </span>}
          {deal.openPrice.toFixed(digits)} → {deal.closePrice.toFixed(digits)}
        </span>
        <span>{stampSecond(deal.closeTime)}</span>
      </div>
    </div>
  );
}
