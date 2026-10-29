import React from 'react';
import SummaryRow from '@/components/ui/SummaryRow';
import { groupedMoney } from '@/lib/money';

/**
 * The foot of the statement: the balance and the working that produced it.
 *
 * Aggregate figures only — individual trade rows live exclusively in the chronological ledger
 * above. Duplicating them here (as "recent trades") broke the ledger's time ordering whenever
 * those trades closed between balance operations, so they were removed. The Deposit, Withdrawal,
 * Profit, Swap, Commission and Balance rows here are enough to reconcile the account fully.
 */
export default function BalanceSummary({
  balance,
  lastMovedMs,
  totals,
  deposit,
  withdrawal,
}: {
  balance: number;
  /** The newest ledger entry's time — frozen, not ticking; it dates a snapshot. */
  lastMovedMs: number;
  totals: { profit: number; swap: number; commission: number };
  deposit: number;
  withdrawal: number;
}) {
  return (
    <>
      <div className="px-4 pt-5 pb-4">
        <SummaryRow label="Deposit" value={groupedMoney(deposit)} />
        {/*
          Signed, because the row is an entry in a sum. `book.withdrawal` accumulates positive,
          but a bare figure between a deposit and a profit reads as another addition. `-0` is not
          a case: it fails the `< 0` test and prints `0.00`.
        */}
        <SummaryRow label="Withdrawal" value={groupedMoney(-withdrawal)} />
        <SummaryRow label="Profit" value={groupedMoney(totals.profit)} />
        <SummaryRow label="Swap" value={groupedMoney(totals.swap)} />
        <SummaryRow label="Commission" value={groupedMoney(totals.commission)} />
        <SummaryRow label="Balance" value={groupedMoney(balance)} />
      </div>
    </>
  );
}
