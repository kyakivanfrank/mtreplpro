import { accrueSwap } from './math';
import type { Book, Deal, OrderRecord, PendingOrder, Position } from './types';

/* ------------------------------------------------------------------ */
/*  Rolling the book back                                              */
/* ------------------------------------------------------------------ */
/**
 * What the account looked like at a moment, worked out from what it looks like now.
 *
 * A rewind does not invalidate an account; it invalidates the part of one that had not happened
 * yet. So there is a single rule, applied per row: **keep what had already happened at `toMs`,
 * undo what had not.** A position opened on Tuesday is still a fact at a Tuesday clock — it
 * simply re-prices against earlier candles, which is what a rewind is *for*.
 *
 * "Undo" is not the same as "delete", and that distinction is most of this file:
 *
 *   opened after `toMs`            never happened — delete
 *   opened before, closed after    was open then — put the position back
 *   placed after `toMs`            never happened — delete
 *   placed before, settled after   was pending then — put the order back
 *
 * Deleting the middle two would contradict the rule the first two are built on.
 *
 * ── One function, two callers ────────────────────────────────────────
 *
 * The store applies this and the chart's confirmation dialog describes it. They must not be two
 * implementations: a dialog that counts differently from the code that acts is worse than no
 * dialog, because it is believed. So this returns the finished book *and* the counts, and the
 * caller picks which it needs.
 */

/** A deal or order record written before stops were recorded cannot be restored faithfully. */
function restorable(row: { sl?: number | null; tp?: number | null }): boolean {
  return row.sl !== undefined || row.tp !== undefined;
}

function positionFromDeal(deal: Deal): Position {
  return {
    // The deal carries the position's own id and ticket, so restoring it cannot collide with
    // anything still open.
    id: deal.id,
    ticket: deal.ticket,
    symbol: deal.symbol,
    type: deal.type,
    volume: deal.volume,
    openPrice: deal.openPrice,
    openTime: deal.openTime,
    sl: deal.sl ?? null,
    tp: deal.tp ?? null,
    commission: deal.commission,
    // Both re-derived below, from the rewound clock rather than from the close.
    swap: 0,
    lastSwapAt: 0,
  };
}

function orderFromRecord(record: OrderRecord): PendingOrder {
  return {
    id: record.id,
    ticket: record.ticket,
    symbol: record.symbol,
    kind: record.kind,
    volume: record.volume,
    price: record.price,
    sl: record.sl ?? null,
    tp: record.tp ?? null,
    placedTime: record.placedTime,
  };
}

/**
 * Financing owed from the position's open up to `toMs`, and nothing after it.
 *
 * Without this a position that survives a Thursday-to-Tuesday rewind keeps its Thursday swap
 * figure: three nights of financing the clock has not reached, sitting in the P/L of a trade
 * being re-run. It is not double-billed on the way forward — `accrueSwap` bills from
 * `lastSwapAt` and would skip those nights — which is worse, because the error is silent and
 * permanent rather than visible.
 *
 * Re-derived by running the engine's own accrual from a clean slate rather than by subtracting,
 * because swap is not linear in time: Wednesday night is charged triple and the weekend not at
 * all. Only the function that knows that can undo it.
 */
function rewindSwap(position: Position, toMs: number): Position {
  const { swap, lastSwapAt } = accrueSwap({ ...position, swap: 0, lastSwapAt: 0 }, toMs);
  if (swap === position.swap && lastSwapAt === position.lastSwapAt) return position;
  return { ...position, swap, lastSwapAt };
}

export interface RewindPlan {
  book: Book;
  /** True when anything at all differs; false means the caller should not write. */
  changed: boolean;
  /** Trades that disappear: opened after `toMs`, or closed after it and not restorable. */
  removed: number;
  /** How many of `removed` are only going because they predate the stop-recording field. */
  legacy: number;
  /** Positions and orders handed back rather than deleted. */
  restored: number;
}

export function planRewind(book: Book, toMs: number): RewindPlan {
  const round = (value: number) => Math.round(value * 100) / 100;

  /* ---------- positions ---------- */

  const positions: Position[] = [];
  let removed = 0;
  let legacy = 0;
  let restored = 0;

  for (const position of book.positions) {
    // Opened after the rewind target: it had not happened, so it does not exist.
    if (position.openTime > toMs) {
      removed += 1;
      continue;
    }
    positions.push(rewindSwap(position, toMs));
  }

  /* ---------- deals ---------- */

  const deals: Deal[] = [];

  for (const deal of book.deals) {
    if (deal.closeTime <= toMs) {
      deals.push(deal);
      continue;
    }

    // The close has not happened. Whether the trade survives depends on when it opened.
    if (deal.openTime > toMs) {
      removed += 1;
      continue;
    }

    if (!restorable(deal)) {
      removed += 1;
      legacy += 1;
      continue;
    }

    positions.push(rewindSwap(positionFromDeal(deal), toMs));
    restored += 1;
  }

  /* ---------- pending orders ---------- */

  const orders: PendingOrder[] = book.orders.filter((order) => order.placedTime <= toMs);
  const orderHistory: OrderRecord[] = [];

  for (const record of book.orderHistory) {
    if (record.settledTime <= toMs) {
      orderHistory.push(record);
      continue;
    }

    // Settled after the target. If it was already sitting there at that moment, it goes back to
    // sitting there — the position it went on to create, if any, is deleted by the rule above.
    if (record.placedTime <= toMs && restorable(record)) {
      orders.push(orderFromRecord(record));
      restored += 1;
    }
  }

  /* ---------- money ---------- */

  /*
   * Walked back by subtracting what the undone rows contributed, never recomputed from scratch.
   * Recomputation would have to reproduce the engine's rounding at every step and would drift
   * from it the first time either changed; subtraction only has to agree with what was added.
   *
   * Every deal closing after `toMs` gives its money back, restored or deleted alike — the close
   * is what realised the profit, and the close has been undone either way.
   */
  let balance = book.balance;
  let deposit = book.deposit;
  let withdrawal = book.withdrawal;

  for (const deal of book.deals) {
    if (deal.closeTime <= toMs) continue;
    balance -= deal.profit + deal.swap + deal.commission;
  }

  const balanceOps = book.balanceOps.filter((op) => op.time <= toMs);

  for (const op of book.balanceOps) {
    if (op.time <= toMs) continue;
    balance -= op.amount;
    if (op.amount > 0) deposit -= op.amount;
    else withdrawal += op.amount; // amount is negative, so this removes it
  }

  /* ---------- did anything move? ---------- */

  /*
   * Lengths are not enough on their own, in both directions.
   *
   * A rewind that drops one pending order and restores another leaves the count identical while
   * the contents differ, so anything removed or restored counts as a change outright. And a
   * count can match while swap has been walked back on a surviving position, so the rows are
   * compared by reference rather than trusted.
   *
   * `deals`, `orderHistory` and `balanceOps` are pure filters of their originals, so equal
   * length does mean equal contents for those three.
   */
  const untouched =
    removed === 0 &&
    restored === 0 &&
    deals.length === book.deals.length &&
    orderHistory.length === book.orderHistory.length &&
    balanceOps.length === book.balanceOps.length &&
    orders.length === book.orders.length &&
    positions.length === book.positions.length &&
    positions.every((position, index) => position === book.positions[index]);

  if (untouched) {
    return { book, changed: false, removed: 0, legacy: 0, restored: 0 };
  }

  return {
    book: {
      ...book,
      balance: round(balance),
      deposit: round(deposit),
      withdrawal: round(withdrawal),
      // Oldest first, matching how the engine appends, so History reads in order.
      positions: positions.sort((a, b) => a.openTime - b.openTime),
      orders: orders.sort((a, b) => a.placedTime - b.placedTime),
      deals,
      orderHistory,
      balanceOps,
      updatedAt: Date.now(),
    },
    changed: true,
    removed,
    legacy,
    restored,
  };
}
