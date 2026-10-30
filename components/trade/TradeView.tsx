'use client';

import React, { useMemo, useState } from 'react';
import ViewLayout from '@/components/ui/ViewLayout';
import ActionSheet from '@/components/ui/ActionSheet';
import BalanceModal from '@/components/settings/BalanceModal';
import CloseTradesModal from '@/components/trade/CloseTradesModal';

import AccountSummary from '@/components/trade/parts/AccountSummary';
import OrdersSection from '@/components/trade/parts/OrdersSection';
import PositionDetail from '@/components/trade/parts/PositionDetail';
import PositionsHeading from '@/components/trade/parts/PositionsHeading';
import PositionsList from '@/components/trade/parts/PositionsList';
import TradeWatermark from '@/components/trade/parts/TradeWatermark';
import {
  TradeHeaderCenter,
  TradeHeaderLeft,
  TradeHeaderRight,
} from '@/components/trade/parts/TradeHeader';
import { positionView } from '@/components/trade/positionView';

import { useQuotes } from '@/lib/market/store';
import { accountSummary, positionNet } from '@/lib/trading/math';
import { useBook, useTrading } from '@/lib/trading/store';
import { useBrokerSymbol, useTradeComment } from '@/lib/account';

/**
 * The open book: a margin readout, the positions, and anything still waiting to fill.
 *
 * This file is the arrangement only. Every row, panel and header slot lives in `./parts`, and
 * the figures a position renders are worked out once in `./positionView`.
 */
export default function TradeView() {
  const book = useBook();
  const { closePosition, closeAll, cancelOrder } = useTrading();
  const toBrokerSymbol = useBrokerSymbol();
  const tradeComment = useTradeComment();

  const [expanded, setExpanded] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(false);

  // Everything held needs a price, whether it is open or merely waiting.
  const symbols = useMemo(
    () => [...new Set([...book.positions, ...book.orders].map((row) => row.symbol))],
    [book.positions, book.orders]
  );
  const quotes = useQuotes(symbols);
  const summary = accountSummary(book.balance, book.positions, quotes);

  /**
   * The book split by which way each position is running.
   *
   * Derived here, against the same live quotes the rows are priced from: a bulk close decided
   * from a different snapshot could close a position the user can see is winning. A position
   * with no quote counts as neither — it cannot be judged, so a selective sweep skips it.
   * "Close all" still takes it.
   */
  const split = useMemo(() => {
    const profitable: string[] = [];
    const losing: string[] = [];

    for (const position of book.positions) {
      const net = positionNet(position, quotes[position.symbol], quotes);
      if (net === null) continue;
      if (net > 0) profitable.push(position.id);
      else if (net < 0) losing.push(position.id);
    }

    return { profitable, losing };
  }, [book.positions, quotes]);

  const holding = book.positions.length > 0;

  /**
   * The expanded position, resolved every render rather than stored — so one that closes under
   * the sheet takes the sheet down with it. Pending orders share the `expanded` slot, so a miss
   * here is ordinary rather than an error.
   */
  const selected = book.positions.find((p) => p.id === expanded) ?? null;

  /** Anything at all in the book. Distinct from `holding`; the watermark does not care which. */
  const busy = holding || book.orders.length > 0;

  return (
    <ViewLayout
      headerLeft={<TradeHeaderLeft onOpenBalance={() => setBalanceOpen(true)} />}
      headerCenter={<TradeHeaderCenter holding={holding} openProfit={summary.openProfit} />}
      headerRight={<TradeHeaderRight />}
      backdrop={<TradeWatermark busy={busy} />}
      edge="fade-min"
    >
      <AccountSummary summary={summary} holding={holding} />

      {holding && <PositionsHeading onBulk={() => setBulkOpen(true)} />}

      <PositionsList
        positions={book.positions}
        quotes={quotes}
        toBrokerSymbol={toBrokerSymbol}
        onOpen={setExpanded}
      />

      <OrdersSection
        orders={book.orders}
        toBrokerSymbol={toBrokerSymbol}
        expanded={expanded}
        onToggle={(id) => setExpanded(expanded === id ? null : id)}
        onCancel={(id) => {
          cancelOrder(id);
          setExpanded(null);
        }}
      />

      <BalanceModal open={balanceOpen} onClose={() => setBalanceOpen(false)} />

      {/*
        The sheet an expanded position raises. `Close position` is red and first, furthest from
        the thumb; `Bulk Operations…` keeps its ellipsis as the one row that leads elsewhere.
      */}
      <ActionSheet
        open={selected !== null}
        onClose={() => setExpanded(null)}
        label={selected ? `Actions for ${toBrokerSymbol(selected.symbol)}` : 'Actions'}
        header={
          selected && (
            <PositionDetail
              position={selected}
              view={positionView(selected, quotes, toBrokerSymbol)}
              comment={tradeComment}
            />
          )
        }
        actions={[
          {
            label: 'Close position',
            destructive: true,
            onClick: () => {
              if (selected) closePosition(selected.id);
              setExpanded(null);
            },
            closes: true,
          },
          // Present, not yet wired. Stops and targets move by dragging their lines on the chart;
          // these press and do nothing rather than promising a screen that is not there.
          { label: 'Modify position' },
          { label: 'Trade' },
          { label: 'Chart' },
          {
            label: 'Bulk Operations...',
            onClick: () => {
              setExpanded(null);
              setBulkOpen(true);
            },
            closes: true,
          },
        ]}
      />

      <CloseTradesModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onCloseAll={() => closeAll()}
        // Snapshotted before the first close: closing one changes the book, and a list rebuilt
        // mid-sweep would be walking a collection it is mutating.
        onCloseProfitable={() => split.profitable.forEach(closePosition)}
        onCloseLosing={() => split.losing.forEach(closePosition)}
      />
    </ViewLayout>
  );
}
