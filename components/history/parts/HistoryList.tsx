import React from 'react';
import DealItem from '@/components/history/parts/DealItem';
import BalanceRow from '@/components/history/parts/BalanceRow';
import OrderRow from '@/components/history/parts/OrderRow';
import type { LedgerRow } from '@/components/history/useHistoryLedger';
import type { Tab } from '@/components/history/tabs';
import type { OrderRecord } from '@/lib/trading/types';

function Empty({ message }: { message: string }) {
  return <div className="px-4 py-8 text-center text-faint text-[14px]">{message}</div>;
}

/**
 * Whichever tab is showing.
 *
 * The `ledger` is the full chronological statement — trades sorted by closeTime, balance ops
 * by their event time, all ascending. No rows are withheld for a summary block; the summary
 * reads aggregate totals, not individual rows.
 *
 * Positions and Deals read the same ledger and render the same records in this app — a
 * position closes in a single deal so there is nothing to split. They stay separate tabs
 * because the terminal has them and they diverge the moment partial closes exist.
 */
export default function HistoryList({
  tab,
  ledger,
  orders,
  toBrokerSymbol,
  balanceOpName,
}: {
  tab: Tab;
  /** Full chronological ledger — trades at closeTime, balance ops at event time, ascending. */
  ledger: LedgerRow[];
  orders: OrderRecord[];
  toBrokerSymbol: (display: string) => string;
  balanceOpName: (op: { id?: string; amount: number; time: number }) => string;
}) {
  if (tab === 'Orders') {
    return (
      <div className="flex flex-col">
        {orders.length === 0 ? (
          <Empty message="No order history" />
        ) : (
          orders.map((order) => (
            <OrderRow
              key={`${order.id}-${order.settledTime}`}
              order={order}
              symbol={toBrokerSymbol(order.symbol)}
            />
          ))
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {ledger.length === 0 ? (
        <Empty message="No history" />
      ) : (
        ledger.map((row) =>
          row.deal ? (
            <DealItem
              key={row.deal.id}
              deal={row.deal}
              symbol={toBrokerSymbol(row.deal.symbol)}
              // The ticket tells two otherwise identical deals apart, which is what the Deals
              // tab is for. On Positions it is noise.
              showTicket={tab === 'Deals'}
            />
          ) : (
            <BalanceRow
              key={row.op!.id}
              op={row.op!}
              account={balanceOpName(row.op!)}
            />
          )
        )
      )}
    </div>
  );
}
