import type { OrderKind } from '@/lib/trading/types';

/**
 * The five order types, in MT5's own order.
 *
 * One sheet covers all of them, as the terminal does: the selection decides whether the ticket
 * ends in a SELL/BUY pair (market) or a single Place button over a trigger price (pending).
 */
export const ORDER_TYPES: { value: OrderKind; label: string }[] = [
  { value: 'market', label: 'Market Execution' },
  { value: 'buy limit', label: 'Buy Limit' },
  { value: 'sell limit', label: 'Sell Limit' },
  { value: 'buy stop', label: 'Buy Stop' },
  { value: 'sell stop', label: 'Sell Stop' },
];
