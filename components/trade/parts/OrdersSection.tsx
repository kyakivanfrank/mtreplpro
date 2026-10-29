import React from 'react';
import type { PendingOrder } from '@/lib/trading/types';
import OrderItem from '@/components/trade/parts/OrderItem';

/** Pending orders — the section only exists when something is waiting, as in MT5. */
export default function OrdersSection({
  orders,
  toBrokerSymbol,
  expanded,
  onToggle,
  onCancel,
}: {
  orders: PendingOrder[];
  toBrokerSymbol: (display: string) => string;
  /** The id of the row currently showing its Cancel button, shared with the positions list. */
  expanded: string | null;
  onToggle: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  if (orders.length === 0) return null;

  return (
    <>
      <div className="sticky-bar flex items-center px-4 h-[30px] mt-1">
        <span className="mt5-cond text-[16px] leading-none">Orders</span>
      </div>
      <div className="flex flex-col">
        {orders.map((order) => (
          <OrderItem
            key={order.id}
            order={order}
            symbol={toBrokerSymbol(order.symbol)}
            expanded={expanded === order.id}
            onToggle={() => onToggle(order.id)}
            onCancel={() => onCancel(order.id)}
          />
        ))}
      </div>
    </>
  );
}
