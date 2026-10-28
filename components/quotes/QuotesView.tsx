'use client';

import React from 'react';
import ViewLayout from '@/components/ui/ViewLayout';
import PencilIcon from '@/components/icons/Pencil';
import SymbolPickerModal from '@/components/quotes/SymbolPickerModal';
import QuoteItem from '@/components/quotes/parts/QuoteItem';
import QuotesSearchBar from '@/components/quotes/parts/QuotesSearchBar';
import { placeholder, toItemProps } from '@/components/quotes/quoteItemProps';
import { useWatchlist } from '@/components/quotes/useWatchlist';
import { useBrokerSymbol } from '@/lib/account';

interface QuotesViewProps {
  /** Tapping a row hands the symbol to the chart. */
  onOpenChart?: (symbol: string) => void;
}

/**
 * The watchlist board.
 *
 * Arrangement only. The row lives in `./parts/QuoteItem`, the figures it renders are shaped in
 * `./quoteItemProps`, and the stored-versus-visible watchlist logic is in `./useWatchlist`.
 */
export default function QuotesView({ onOpenChart }: QuotesViewProps) {
  const { rows, quotes, targetIndex, pickerOpen, openPicker, closePicker, selectInstrument } =
    useWatchlist();

  // The account type owns naming: rows show the configured suffix, not the feed's.
  const toBrokerSymbol = useBrokerSymbol();

  return (
    <>
      <ViewLayout
        headerLeft={
          <div className="w-[52px] h-[52px] flex items-center justify-start cursor-pointer">
            <PencilIcon className="w-[26px] h-[26px] text-white" />
          </div>
        }
        headerCenter={<div className="font-semibold text-[17px]">Quotes</div>}
      >
        <div className="px-4 pb-2">
          <QuotesSearchBar onOpen={() => openPicker(targetIndex)} />

          <div className="flex flex-col">
            {rows.map((row, i) => {
              const quote = quotes[row.symbol];
              const props = quote ? toItemProps(quote) : placeholder(row.display);

              return (
                <QuoteItem
                  key={row.symbol}
                  {...props}
                  symbol={toBrokerSymbol(props.symbol)}
                  selected={i === targetIndex}
                  onClick={onOpenChart ? () => onOpenChart(row.symbol) : undefined}
                  onLongPress={() => openPicker(i)}
                />
              );
            })}
          </div>
        </div>
      </ViewLayout>

      <SymbolPickerModal
        open={pickerOpen}
        targetDisplay={rows[targetIndex].display}
        usedSymbols={rows.map((r) => r.symbol)}
        onSelect={selectInstrument}
        onClose={closePicker}
      />
    </>
  );
}
