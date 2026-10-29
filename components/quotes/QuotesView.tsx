'use client';

import React from 'react';
import ViewLayout from '@/components/ui/ViewLayout';
import ListBulletIcon from '@/components/icons/ListBullet';
import PencilIcon from '@/components/icons/Pencil';
import SearchIcon from '@/components/icons/Search';
import SymbolPickerModal from '@/components/quotes/SymbolPickerModal';
import QuoteItem from '@/components/quotes/parts/QuoteItem';
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
          <button
            type="button"
            aria-label="View mode"
            className="glass-control w-[44px] h-[44px] rounded-full flex items-center justify-center"
          >
            <ListBulletIcon className="w-[22px] h-[22px] text-white" />
          </button>
        }
        headerCenter={<div className="font-semibold text-[17px]">Quotes</div>}
        headerRight={
          <div className="glass-control h-[44px] rounded-full flex items-center px-1">
            <button type="button" aria-label="Edit" className="w-[46px] h-[44px] flex items-center justify-center">
              <PencilIcon className="w-[21px] h-[21px]" />
            </button>
            <button
              type="button"
              aria-label="Search symbols"
              onClick={() => openPicker(targetIndex)}
              className="w-[46px] h-[44px] flex items-center justify-center"
            >
              <SearchIcon className="w-[22px] h-[22px] text-white" />
            </button>
          </div>
        }
      >
        <div className="pb-2">
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
        targetDisplay={rows[targetIndex]?.display ?? ''}
        usedSymbols={rows.map((r) => r.symbol)}
        onSelect={selectInstrument}
        onClose={closePicker}
      />
    </>
  );
}
