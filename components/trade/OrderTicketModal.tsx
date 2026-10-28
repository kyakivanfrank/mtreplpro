'use client';

import React from 'react';
import Portal from '@/components/ui/Portal';
import VolumeInput from '@/components/trade/VolumeInput';
import LevelRow from '@/components/trade/parts/LevelRow';
import OrderTypePicker from '@/components/trade/parts/OrderTypePicker';
import TicketActions from '@/components/trade/parts/TicketActions';
import { useOrderTicket } from '@/components/trade/useOrderTicket';
import { brokerSymbol, useAccount } from '@/lib/account';
import type { LevelField } from '@/components/chart/chartConfig';

export type { LevelField };

interface OrderTicketModalProps {
  open: boolean;
  symbol: string;
  onClose: () => void;
  /**
   * Hand a level over to the chart to be aimed at.
   *
   * The ticket covers the chart, so picking is a hand-off: the host hides this sheet, shows a
   * crosshair, and passes the chosen price back through `picked`.
   */
  onPickLevel?: (field: LevelField, current: number | null) => void;
  /** A level chosen on the chart. `seq` rises per pick, so the same price twice still lands. */
  picked?: { field: LevelField; price: number; seq: number } | null;
}

/**
 * MT5's order ticket.
 *
 * Arrangement only. The fields, the price seeding and what Place does live in
 * `./useOrderTicket`; the type list, the level rows and the action buttons in `./parts`.
 *
 * The instrument arrives canonically ("XAUUSD") and is only ever displayed with the broker
 * suffix applied — nothing here feeds a suffixed name back into a lookup.
 */
export default function OrderTicketModal({
  open,
  symbol,
  onClose,
  onPickLevel,
  picked,
}: OrderTicketModalProps) {
  const account = useAccount();
  const t = useOrderTicket({ open, symbol, picked, onClose });

  if (!open) return null;

  const display = brokerSymbol(t.instrument?.display ?? symbol.replace('/', ''), account);
  const fallbackPrice = t.quote?.bid ?? null;

  const level = (field: LevelField, label: string, value: string, set: (v: string) => void, placeholder?: string) => (
    <LevelRow
      field={field}
      label={label}
      value={value}
      onChange={set}
      placeholder={placeholder}
      digits={t.digits}
      point={t.point}
      fallbackPrice={fallbackPrice}
      onPickLevel={onPickLevel}
    />
  );

  return (
    // z-[75] sits above the account sheet (70) and below the outage modal (100).
    <Portal>
      <div className="fixed inset-0 z-[75] flex flex-col bg-black text-white font-sans pt-[var(--safe-top)]">
        {/* Header */}
        <div className="pt-4 pb-4 px-4 flex justify-between items-center relative shrink-0">
          <div className="flex-1 flex justify-start z-10">
            <button onClick={onClose} className="text-accent text-[17px]">Cancel</button>
          </div>
          <div className="absolute left-1/2 -translate-x-1/2 z-0 font-semibold text-[17px]">{display}</div>
          <div className="flex-1" />
        </div>

        <div className="flex-1 overflow-y-auto">
          <OrderTypePicker
            kind={t.kind}
            open={t.typeOpen}
            onToggle={() => t.setTypeOpen(!t.typeOpen)}
            onSelect={t.selectKind}
          />

          <div className="flex items-center justify-between px-4 py-3 border-b border-surface-2">
            <span className="text-white text-[16px]">Volume</span>
            <VolumeInput value={t.volume} onChange={t.setVolume} symbol={symbol} className="gap-3" />
          </div>

          {t.isPending && level('price', 'Price', t.price, t.setPrice, '0.00')}
          {level('sl', 'Stop Loss', t.sl, t.setSl)}
          {level('tp', 'Take Profit', t.tp, t.setTp)}

          {/* Current market, so the user can see what they are pricing against */}
          <div className="px-4 py-3 flex justify-between text-[13px] text-muted">
            <span>Bid {t.quote ? t.quote.bid.toFixed(t.digits) : '—'}</span>
            <span>Ask {t.quote ? t.quote.ask.toFixed(t.digits) : '—'}</span>
          </div>

          {t.error && <div className="px-4 py-2 text-danger text-[14px] leading-[19px]">{t.error}</div>}
          {t.done && <div className="px-4 py-2 text-accent text-[14px] leading-[19px]">{t.done}</div>}

          <TicketActions
            isPending={t.isPending}
            disabled={!t.quote}
            bid={t.quote ? t.quote.bid.toFixed(t.digits) : ''}
            ask={t.quote ? t.quote.ask.toFixed(t.digits) : ''}
            onPlace={() => t.submit()}
            onTrade={t.submit}
          />

          <div className="h-[calc(2.5rem+var(--safe-bottom))]" />
        </div>
      </div>
    </Portal>
  );
}
