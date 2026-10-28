import { useMemo } from 'react';
import type { BalanceOp, Deal } from '@/lib/trading/types';
import type { useBook } from '@/lib/trading/store';

export interface LedgerRow {
  time: number;
  deal?: Deal;
  op?: BalanceOp;
}

/**
 * The history screen's derived data, in one place.
 *
 * Everything here is chronological, oldest first — exactly as the MT5 DEALS ledger works.
 *
 * Ordering rule (from real MT5 account data):
 *   • A closed trade appears at its **closeTime** — when P/L was realised and balance changed.
 *   • A deposit/withdrawal appears at its **time** — when the money moved.
 *   • Sort ascending: oldest entry at the top, newest at the bottom.
 *
 * This means a position that opened before a withdrawal but closed after it will appear
 * below the withdrawal row in the list — its chronological slot is its close time, not its
 * open time. This is identical to how the real MT5 terminal orders the Deals/Positions tabs.
 *
 * No "recent vs older" split: splitting the last N trades out of the ledger into a summary
 * block breaks chronological context whenever those trades close between balance operations.
 * The BalanceSummary block reads aggregate totals from book.deals directly instead.
 */
export function useHistoryLedger(book: ReturnType<typeof useBook>) {
  /**
   * Trades and money movements merged into one chronological run — the statement of account.
   *
   * Balance operations sit *between* trades rather than in their own section, and that
   * placement carries information: a deposit at 09:24 that sits between a close at 09:24:49
   * and a close at 09:25:40 tells you exactly which trades each dollar funded.
   */
  const ledger = useMemo<LedgerRow[]>(() => {
    const rows: LedgerRow[] = [
      ...book.deals.map((deal) => ({ time: deal.closeTime, deal })),
      ...book.balanceOps.map((op) => ({ time: op.time, op })),
    ];

    return rows.sort((a, b) => {
      // Primary: timestamp ascending (both in Unix ms).
      if (a.time !== b.time) return a.time - b.time;
      // Secondary: balance ops before deal closes that land at the exact same ms,
      // matching the MT5 convention where the balance row precedes the trade that
      // immediately follows a deposit/withdrawal.
      const aIsOp = a.op !== undefined ? 0 : 1;
      const bIsOp = b.op !== undefined ? 0 : 1;
      if (aIsOp !== bIsOp) return aIsOp - bIsOp;
      // Tertiary: ticket / id so two deals at the same ms render in a stable, deterministic order.
      const aTicket = a.deal?.ticket ?? a.op?.ticket ?? 0;
      const bTicket = b.deal?.ticket ?? b.op?.ticket ?? 0;
      return aTicket - bTicket;
    });
  }, [book.deals, book.balanceOps]);

  const totals = useMemo(() => {
    let profit = 0;
    let swap = 0;
    let commission = 0;

    for (const deal of book.deals) {
      profit += deal.profit;
      swap += deal.swap;
      commission += deal.commission;
    }

    return { profit, swap, commission };
  }, [book.deals]);

  return { ledger, totals };
}
