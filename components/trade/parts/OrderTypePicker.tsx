import React from 'react';
import { ORDER_TYPES } from '@/components/trade/orderTypes';
import type { OrderKind } from '@/lib/trading/types';

/** The type selector at the head of the ticket, and the list it unrolls. */
export default function OrderTypePicker({
  kind,
  open,
  onToggle,
  onSelect,
}: {
  kind: OrderKind;
  open: boolean;
  onToggle: () => void;
  onSelect: (kind: OrderKind) => void;
}) {
  return (
    <div className="border-y border-surface-2">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3">
        <span className="text-white text-[16px]">
          {ORDER_TYPES.find((t) => t.value === kind)?.label}
        </span>
        <span className="text-muted text-[13px]">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-surface-2">
          {ORDER_TYPES.map((type) => (
            <button
              key={type.value}
              onClick={() => onSelect(type.value)}
              className={`block w-full text-left px-4 py-2.5 text-[15px] ${
                type.value === kind ? 'text-accent bg-white/5' : 'text-white'
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
