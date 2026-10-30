'use client';

import React, { useEffect, useState } from 'react';
import ViewLayout from '@/components/ui/ViewLayout';
import BalanceSummary from '@/components/history/parts/BalanceSummary';
import HistoryList from '@/components/history/parts/HistoryList';
import {
  HistoryHeaderCenter,
  HistoryHeaderLeft,
  HistoryHeaderRight,
} from '@/components/history/parts/HistoryHeader';
import { useHistoryLedger } from '@/components/history/useHistoryLedger';
import type { Tab } from '@/components/history/tabs';
import { useBalanceOpName, useBrokerSymbol } from '@/lib/account';
import { marketStore } from '@/lib/market/store';
import { useBook } from '@/lib/trading/store';

/**
 * The statement: closed trades, settled orders and money movements, ending on the balance.
 *
 * Arrangement only. Rows live in `./parts`, and the full chronological ledger and totals
 * are derived in `./useHistoryLedger`.
 */
export default function HistoryView() {
  const book = useBook();
  const toBrokerSymbol = useBrokerSymbol();
  const balanceOpName = useBalanceOpName();
  const [tab, setTab] = useState<Tab>('Positions');

  const { ledger, totals } = useHistoryLedger(book);

  /*
   * What dates the balance when nothing in the ledger can.
   *
   * A fresh account has a balance and no history: the opening deposit is seeded straight into
   * `balance`/`deposit` rather than written as a balance operation, so until the first trade
   * closes or the first deposit lands there is no record whose time this figure could borrow,
   * and it rendered as an em dash -- "unknown" about the one number the app is most sure of.
   *
   * The market clock, like every other stamp in the book, so a balance read during playback of
   * a Tuesday in March is dated that Tuesday rather than today. Read after mount, because a
   * clock read in a render body gives the server one string and the browser another; and
   * sampled once, because this dates a snapshot and a ticking clock beside a figure that is
   * standing still claims the figure is being recomputed.
   */
  const [clockNow, setClockNow] = useState(0);

  useEffect(() => {
    setClockNow(marketStore.getClock());
  }, []);

  return (
    <ViewLayout
      headerLeft={<HistoryHeaderLeft />}
      headerCenter={<HistoryHeaderCenter tab={tab} onChange={setTab} />}
      headerRight={<HistoryHeaderRight />}
      edge="fade-min"
      // The default plus a few px on top: flush, the top edge of the tab strip and its two
      // circles was clipped against the black status band above.
      headerClassName="min-h-[54px] pt-[4px] pb-[10px] px-4"
    >
      <HistoryList
        tab={tab}
        ledger={ledger}
        // Already appended in time order, so oldest-first is the stored order — no work.
        orders={book.orderHistory}
        toBrokerSymbol={toBrokerSymbol}
        balanceOpName={balanceOpName}
      />

      <BalanceSummary
        balance={book.balance}
        lastMovedMs={ledger[ledger.length - 1]?.time ?? clockNow}
        totals={totals}
        deposit={book.deposit}
        withdrawal={book.withdrawal}
      />
    </ViewLayout>
  );
}
