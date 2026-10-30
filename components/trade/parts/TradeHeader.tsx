import React from 'react';
import CreditCardIcon from '@/components/icons/CreditCard';
import PlusIcon from '@/components/icons/Plus';
import { profitTone } from '@/lib/trading/profit';
import { groupedMoney } from '@/lib/money';

/* ------------------------------------------------------------------ */
/*  The three slots of the Trade header                                */
/* ------------------------------------------------------------------ */
/* Three exports, not one component: `ViewLayout` takes the slots as separate props. */

/** Opens the deposit/withdraw dialog. */
export function TradeHeaderLeft({ onOpenBalance }: { onOpenBalance: () => void }) {
  return (
    <button
      onClick={onOpenBalance}
      aria-label="Balance"
      className="glass-control w-[44px] h-[44px] rounded-full flex items-center justify-center cursor-pointer"
    >
      <CreditCardIcon />
    </button>
  );
}

/**
 * The running total. Three states, not two: flat is white, because `>= 0` painted an untouched
 * account blue. With nothing open it shows the currency alone — "0.00" would read as a result
 * rather than as the absence of one.
 */
export function TradeHeaderCenter({
  holding,
  openProfit,
}: {
  holding: boolean;
  openProfit: number;
}) {
  return (
    <div className={`mt5-cond text-[23px] leading-none ${profitTone(holding ? openProfit : 0)}`}>
      {holding ? `${groupedMoney(openProfit)} USD` : 'USD'}
    </div>
  );
}

/*
 * The plus, deliberately inert. This tab shows the whole book, so "new order" here would have to
 * invent a symbol to be about; the ticket opens from the chart instead. Kept because the header
 * is a three-part bar, with `aria-disabled` so a screen reader learns what the finger does.
 */
export function TradeHeaderRight() {
  return (
    <button
      type="button"
      aria-label="New order"
      aria-disabled="true"
      className="glass-control w-[44px] h-[44px] rounded-full flex items-center justify-center"
    >
      <PlusIcon />
    </button>
  );
}
