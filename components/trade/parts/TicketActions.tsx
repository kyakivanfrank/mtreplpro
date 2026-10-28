import React from 'react';

/**
 * How the ticket ends: one Place button for a pending order, or the SELL/BUY pair for a market
 * one, each carrying the price it would fill at.
 */
export default function TicketActions({
  isPending,
  disabled,
  bid,
  ask,
  onPlace,
  onTrade,
}: {
  isPending: boolean;
  disabled: boolean;
  bid: string;
  ask: string;
  onPlace: () => void;
  onTrade: (side: 'buy' | 'sell') => void;
}) {
  if (isPending) {
    return (
      <div className="px-4 py-4">
        <button
          onClick={onPlace}
          disabled={disabled}
          className="w-full h-[50px] rounded-[10px] bg-accent text-white text-[17px] font-semibold disabled:opacity-40"
        >
          Place Order
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <div className="flex gap-3">
        <button
          onClick={() => onTrade('sell')}
          disabled={disabled}
          className="flex-1 h-[50px] rounded-[10px] bg-[#D15247] text-white text-[17px] font-semibold disabled:opacity-40"
        >
          Sell {bid}
        </button>
        <button
          onClick={() => onTrade('buy')}
          disabled={disabled}
          className="flex-1 h-[50px] rounded-[10px] bg-[#4786DC] text-white text-[17px] font-semibold disabled:opacity-40"
        >
          Buy {ask}
        </button>
      </div>
    </div>
  );
}
