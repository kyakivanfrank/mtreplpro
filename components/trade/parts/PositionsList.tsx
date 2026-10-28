import React from 'react';
import type { QuoteState } from '@/lib/market/store';
import type { Position } from '@/lib/trading/types';
import PositionItem from '@/components/trade/parts/PositionItem';
import { positionView } from '@/components/trade/positionView';

/**
 * The open positions. No fill of its own — the watermark behind it does its own dimming — and
 * no empty-state line, because the mark already says the account is flat.
 */
export default function PositionsList({
  positions,
  quotes,
  toBrokerSymbol,
  onOpen,
}: {
  positions: Position[];
  quotes: Record<string, QuoteState>;
  toBrokerSymbol: (display: string) => string;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex py-1 flex-col">
      {positions.map((position) => (
        <PositionItem
          key={position.id}
          position={position}
          view={positionView(position, quotes, toBrokerSymbol)}
          onOpen={() => onOpen(position.id)}
        />
      ))}
    </div>
  );
}
