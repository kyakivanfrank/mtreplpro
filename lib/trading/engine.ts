import { findInstrument } from '@/lib/instruments';
import type { Tick } from '@/lib/market/types';
import type { QuoteState } from '@/lib/market/store';
import {
  accountSummary,
  accrueSwap,
  contractSize,
  convertToDeposit,
  EQUITY_FLOOR,
  formatVolume,
  freeMarginOf,
  marginAction,
  normalizeVolume,
  positionNet,
  volumeSpec,
} from './math';
import {
  advanceTicket,
  type BalanceOp,
  sideOf,
  type Book,
  type CloseReason,
  type Deal,
  type OrderRequest,
  type OrderResult,
  type PendingKind,
  type PendingOrder,
  type Position,
  type Side,
} from './types';

/* ------------------------------------------------------------------ */
/*  The order engine                                                   */
/* ------------------------------------------------------------------ */
/**
 * Pure functions over a `Book`. Nothing here reads a clock, touches storage or knows whether
 * when the prices it is handed were printed — the caller supplies the price and the timestamp.
 * That is what lets the session play stored candles through the very same code path,
 * and it also makes every rule below testable without a market.
 *
 * The rules implemented are MT5's, not a simplification of them:
 *   · a buy fills at the ask and closes at the bid; a sell does the reverse
 *   · a pending order must sit on the correct side of the market, beyond the stops level
 *   · stop loss and take profit are checked against the side the position *closes* at
 *
 * One rule is deliberately not MT5's: *margin* does not gate order entry. Leverage is finite
 * (1:500), so every position ties up real collateral and every margin figure on the account is
 * a live number — but a rejected order is a real broker protecting a loan, and nothing is being
 * lent here. Money still gates entry — see `openPosition` — and the account is liquidated at a
 * stop out or at zero equity, whichever comes first, see `enforceMargin`.
 */

export interface PriceSnapshot {
  bid: number;
  ask: number;
}

/** Fills happen at the side the order actually trades against. */
function fillPrice(side: Side, price: PriceSnapshot): number {
  return side === 'buy' ? price.ask : price.bid;
}

/**
 * Minimum distance between the market and a pending order or a stop, in price terms.
 *
 * Brokers enforce this (`SYMBOL_TRADE_STOPS_LEVEL`) to stop orders being parked inside the
 * spread where they would fill instantly. Modelled here as the instrument's own spread.
 */
function stopsLevel(symbol: string): number {
  const instrument = findInstrument(symbol);
  const digits = instrument?.digits ?? 5;
  const points = Math.max(1, instrument?.spread ?? 2);
  return points * 10 ** -digits;
}

/**
 * How far a default stop sits from the entry.
 *
 * Every trade opened from the chart's buy/sell buttons gets one, because a position with no
 * protection is not what those buttons are for here — the point of the exercise is practising
 * a whole trade, and in MT5 you would attach the stops in the ticket before pressing.
 *
 * ── Far enough to be a placeholder, not a decision ───────────────────
 *
 * These used to sit ten spreads out: about ten pips on EURUSD, which the tape crosses in
 * minutes — and at five times real time, in well under a minute of watching. A default that
 * closes the trade before the user has decided anything is not protection, it is a countdown.
 * The honest alternative would be to attach no stops at all, but then the lines are not on the
 * chart to drag and the feature has to be discovered rather than adjusted.
 *
 * So they are placed far enough out to be inert: a level the price is unlikely to reach while
 * the user is still making up their mind, sitting there ready to be dragged in. Removing them
 * without removing them.
 *
 * ── Why a share of the price ─────────────────────────────────────────
 *
 * Distance is a percentage of the entry, not a multiple of the spread. Spread tracks how
 * expensive an instrument is to trade, not how far it travels, and across asset classes those
 * come apart badly — gold's spread is three times EURUSD's while its daily range is hundreds
 * of times larger in points. A percentage is the same *amount of market* everywhere: five
 * percent is several days of range on a major, on metals and on crypto alike.
 *
 * The spread floor survives underneath for an instrument whose price is small enough that a
 * percentage would land inside the spread.
 */
const DEFAULT_STOP_PERCENT = 0.05;
const DEFAULT_STOP_MIN_SPREADS = 50;

function defaultStopDistance(symbol: string, entry: number): number {
  const instrument = findInstrument(symbol);
  const digits = instrument?.digits ?? 5;
  const point = 10 ** -digits;

  const floor = (instrument?.spread ?? 2) * DEFAULT_STOP_MIN_SPREADS * point;
  return Math.max(Math.abs(entry) * DEFAULT_STOP_PERCENT, floor);
}

/** Entry-relative stop and target for a trade that did not specify them. */
export function defaultStops(
  symbol: string,
  side: Side,
  entry: number
): { sl: number; tp: number } {
  const distance = defaultStopDistance(symbol, entry);
  const direction = side === 'buy' ? 1 : -1;

  return {
    sl: round(entry - direction * distance, symbol),
    // Two to one, which is the ratio every course opens with and a reasonable thing to have
    // to move rather than to invent from nothing.
    tp: round(entry + direction * distance * 2, symbol),
  };
}

/**
 * Move a position's stop loss or take profit.
 *
 * `undefined` leaves a level alone; `null` clears it. Both are validated against the entry
 * exactly as they would be on the ticket, so a stop cannot be dragged through the price to
 * the wrong side of the trade.
 */
export function modifyPosition(
  book: Book,
  id: string,
  changes: { sl?: number | null; tp?: number | null }
): { ok: true; book: Book } | { ok: false; error: string } {
  const position = book.positions.find((p) => p.id === id);
  if (!position) return { ok: false, error: 'Position not found' };

  const sl = changes.sl === undefined ? position.sl : changes.sl;
  const tp = changes.tp === undefined ? position.tp : changes.tp;

  const error = validateStops(position.symbol, position.type, position.openPrice, sl, tp);
  if (error) return { ok: false, error };

  const updated: Position = {
    ...position,
    sl: sl === null ? null : round(sl, position.symbol),
    tp: tp === null ? null : round(tp, position.symbol),
  };

  return {
    ok: true,
    book: touch({
      ...book,
      positions: book.positions.map((p) => (p.id === id ? updated : p)),
    }),
  };
}

function round(value: number, symbol: string): number {
  const digits = findInstrument(symbol)?.digits ?? 5;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function touch(book: Book): Book {
  return { ...book, updatedAt: Date.now() };
}

let idSeq = 0;
function newId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeq.toString(36)}`;
}

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */

/**
 * Volume, against the instrument's own limits rather than one set for everything.
 *
 * The step is checked, not just the range. A broker that offers XRP in whole lots does not
 * accept 1.5 of them, and silently rounding the request would fill a size the user did not
 * ask for — which is the one outcome an order ticket must never produce. MT5 refuses with
 * "Invalid volume" and so does this.
 *
 * The tolerance is a millionth of a lot, which is float noise from arithmetic upstream rather
 * than anything a user could have typed.
 */
function validateVolume(volume: number, symbol: string): string | null {
  if (!Number.isFinite(volume)) return 'Invalid volume';

  const { min, max, step, digits } = volumeSpec(symbol);

  if (volume < min) return `Minimum volume is ${min.toFixed(digits)}`;
  if (volume > max) return `Maximum volume is ${max.toFixed(digits)}`;

  const offBy = Math.abs(volume / step - Math.round(volume / step));
  if (offBy > 1e-6) return `Volume must be a multiple of ${step.toFixed(digits)}`;

  return null;
}

/**
 * Stops must be on the losing side for SL and the winning side for TP, measured against the
 * price the position will *close* at. Getting this backwards is MT5's "Invalid S/L or T/P".
 */
function validateStops(
  symbol: string,
  side: Side,
  entry: number,
  sl: number | null | undefined,
  tp: number | null | undefined
): string | null {
  const gap = stopsLevel(symbol);

  if (sl != null) {
    if (side === 'buy' && sl >= entry - gap) return 'Stop Loss must sit below the entry price';
    if (side === 'sell' && sl <= entry + gap) return 'Stop Loss must sit above the entry price';
  }

  if (tp != null) {
    if (side === 'buy' && tp <= entry + gap) return 'Take Profit must sit above the entry price';
    if (side === 'sell' && tp >= entry - gap) return 'Take Profit must sit below the entry price';
  }

  return null;
}

/** A pending order parked on the wrong side of the market would fill the instant it is placed. */
function validatePendingPrice(
  kind: PendingKind,
  symbol: string,
  price: number,
  market: PriceSnapshot
): string | null {
  const gap = stopsLevel(symbol);

  switch (kind) {
    case 'buy limit':
      return price <= market.ask - gap ? null : 'Buy Limit must be placed below the market';
    case 'sell limit':
      return price >= market.bid + gap ? null : 'Sell Limit must be placed above the market';
    case 'buy stop':
      return price >= market.ask + gap ? null : 'Buy Stop must be placed above the market';
    case 'sell stop':
      return price <= market.bid - gap ? null : 'Sell Stop must be placed below the market';
  }
}

/* ------------------------------------------------------------------ */
/*  Opening                                                            */
/* ------------------------------------------------------------------ */

/** Open a position immediately at the current market price. */
export function placeMarket(
  book: Book,
  request: OrderRequest,
  market: PriceSnapshot,
  quotes: Record<string, QuoteState>,
  now: number
): OrderResult {
  const volumeError = validateVolume(request.volume, request.symbol);
  if (volumeError) return { ok: false, error: volumeError };

  const side: Side =
    request.kind === 'market' ? (request.side ?? 'buy') : sideOf(request.kind as PendingKind);

  return openPosition(
    book,
    request.symbol,
    side,
    normalizeVolume(request.volume, request.symbol),
    market,
    quotes,
    now,
    request.sl,
    request.tp
  );
}

/** Shared by market orders and by pending orders that have just triggered. */
function openPosition(
  book: Book,
  symbol: string,
  side: Side,
  volume: number,
  market: PriceSnapshot,
  quotes: Record<string, QuoteState>,
  now: number,
  sl?: number | null,
  tp?: number | null,
  fromOrder?: number
): OrderResult {
  const entry = fillPrice(side, market);

  const stopError = validateStops(symbol, side, entry, sl, tp);
  if (stopError) return { ok: false, error: stopError };

  /*
   * No margin check — and one solvency check.
   *
   * Margin never refuses an order. A real broker refuses because it is lending the money and
   * wants it back; nothing is being lent here, and the only thing a margin gate can do is stop
   * the user testing the idea they opened the app to test. The margin the position requires is
   * still computed and still shown — free margin falls by it the moment the trade opens — it
   * simply is not a veto.
   *
   * What *does* refuse an order is having no money. An account whose equity has reached zero
   * has been liquidated and is finished — letting it keep opening positions would be trading
   * with money that does not exist, and it is exactly how a book ends up several thousand
   * dollars in the red on a four-hundred-dollar balance. This is MT5's "Not enough money", and
   * it is the floor the whole account rests on: `enforceMargin` closes everything at zero
   * equity, and this stops anything reopening below it.
   */
  const solvency = accountSummary(book.balance, book.positions, quotes);
  if (solvency.equity <= EQUITY_FLOOR) return { ok: false, error: 'Not enough money' };

  const position: Position = {
    id: newId('pos'),
    ticket: book.nextTicket,
    symbol,
    type: side,
    volume,
    openPrice: entry,
    openTime: now,
    sl: sl ?? null,
    tp: tp ?? null,
    commission: 0,
    swap: 0,
    lastSwapAt: now,
    fromOrder,
  };

  return {
    ok: true,
    ticket: position.ticket,
    book: touch({
      ...book,
      positions: [...book.positions, position],
      nextTicket: advanceTicket(book.nextTicket),
    }),
  };
}

/** Park a limit or stop order to be filled when the market reaches it. */
export function placePending(
  book: Book,
  request: OrderRequest,
  market: PriceSnapshot,
  quotes: Record<string, QuoteState>,
  now: number
): OrderResult {
  if (request.kind === 'market') return { ok: false, error: 'Not a pending order' };

  const volumeError = validateVolume(request.volume, request.symbol);
  if (volumeError) return { ok: false, error: volumeError };

  // Same solvency floor as a market order. A liquidated account could otherwise park orders
  // that would be cancelled the instant they triggered, which reads as the terminal losing
  // them rather than as the account being finished.
  const solvency = accountSummary(book.balance, book.positions, quotes);
  if (solvency.equity <= EQUITY_FLOOR) return { ok: false, error: 'Not enough money' };

  if (request.price == null || !Number.isFinite(request.price)) {
    return { ok: false, error: 'Invalid price' };
  }

  const kind = request.kind;
  const price = round(request.price, request.symbol);

  const priceError = validatePendingPrice(kind, request.symbol, price, market);
  if (priceError) return { ok: false, error: priceError };

  const stopError = validateStops(request.symbol, sideOf(kind), price, request.sl, request.tp);
  if (stopError) return { ok: false, error: stopError };

  const order: PendingOrder = {
    id: newId('ord'),
    ticket: book.nextTicket,
    symbol: request.symbol,
    kind,
    volume: normalizeVolume(request.volume, request.symbol),
    price,
    sl: request.sl ?? null,
    tp: request.tp ?? null,
    placedTime: now,
  };

  return {
    ok: true,
    ticket: order.ticket,
    book: touch({
      ...book,
      orders: [...book.orders, order],
      nextTicket: advanceTicket(book.nextTicket),
    }),
  };
}

export function cancelOrder(book: Book, id: string, now: number): Book {
  const order = book.orders.find((o) => o.id === id);
  if (!order) return book;

  return touch({
    ...book,
    orders: book.orders.filter((o) => o.id !== id),
    orderHistory: [
      ...book.orderHistory,
      { ...settledRecord(order, now, 'cancelled') },
    ],
  });
}

function settledRecord(
  order: PendingOrder,
  settledTime: number,
  outcome: 'filled' | 'cancelled'
) {
  return {
    id: order.id,
    ticket: order.ticket,
    symbol: order.symbol,
    kind: order.kind,
    volume: order.volume,
    price: order.price,
    placedTime: order.placedTime,
    settledTime,
    outcome,
    // As on the deal: enough to put the order back if the clock rewinds past its settlement.
    sl: order.sl,
    tp: order.tp,
  };
}

/* ------------------------------------------------------------------ */
/*  Closing                                                            */
/* ------------------------------------------------------------------ */

/** Close one position at the current market and write the deal into history. */
export function closePosition(
  book: Book,
  id: string,
  market: PriceSnapshot,
  now: number,
  reason: CloseReason = 'manual',
  quotes?: Record<string, QuoteState>
): Book {
  const position = book.positions.find((p) => p.id === id);
  if (!position) return book;

  return applyClose(book, position, market, now, reason, quotes);
}

/**
 * Realise a position.
 *
 * `quotes` is only ever read for a cross rate, and it matters that it is passed: the floating
 * figure the user was watching is converted into the deposit currency, so a realised one that
 * skipped the conversion would move the balance by a different number than the screen showed.
 */
function applyClose(
  book: Book,
  position: Position,
  market: PriceSnapshot,
  now: number,
  reason: CloseReason,
  quotes?: Record<string, QuoteState>,
  closeAt?: number
): Book {
  const closePrice = closeAt ?? (position.type === 'buy' ? market.bid : market.ask);

  const move =
    position.type === 'buy'
      ? closePrice - position.openPrice
      : position.openPrice - closePrice;

  const gross = convertToDeposit(
    move * position.volume * contractSize(position.symbol),
    position.symbol,
    quotes
  );
  const net = gross + position.swap + position.commission;

  const deal: Deal = {
    id: position.id,
    ticket: position.ticket,
    symbol: position.symbol,
    type: position.type,
    volume: position.volume,
    openPrice: position.openPrice,
    closePrice,
    openTime: position.openTime,
    closeTime: now,
    profit: Math.round(gross * 100) / 100,
    commission: position.commission,
    swap: position.swap,
    reason,
    // Written on every close so a rewind past it can restore the position whole.
    sl: position.sl,
    tp: position.tp,
  };

  return touch({
    ...book,
    // Only the realised amount moves the balance; that is the definition of realised.
    balance: Math.round((book.balance + net) * 100) / 100,
    positions: book.positions.filter((p) => p.id !== position.id),
    deals: [...book.deals, deal],
  });
}

/**
 * Close every open position, or every one on a single symbol.
 *
 * Positions on instruments with no current quote are left alone rather than closed at a made-up
 * price — silently inventing a fill would corrupt the balance.
 */
export function closeAll(
  book: Book,
  quotes: Record<string, QuoteState>,
  now: number,
  symbol?: string
): Book {
  let next = book;

  for (const position of book.positions) {
    if (symbol && position.symbol !== symbol) continue;

    const quote = quotes[position.symbol];
    if (!quote) continue;

    next = applyClose(next, position, quote, now, 'close-all', quotes);
  }

  return next;
}

/* ------------------------------------------------------------------ */
/*  Margin enforcement — the floor under the account                   */
/* ------------------------------------------------------------------ */
/**
 * The rule that stops an account rather than letting it run to nothing.
 *
 * This is the piece that was missing, and its absence is what produced a book showing a
 * balance of 481, an equity of −2,926 and a margin level of −353%. Every one of those numbers
 * was arithmetically correct and none of them can exist on a real terminal, because a broker
 * closes the account long before it gets there. Equity below zero means the account owes money
 * it never had; a negative margin level means the ratio protecting the broker inverted. A
 * terminal that prints them is not simulating trading, it is simulating a spreadsheet.
 *
 * Two enforcement paths, matching MT5's two:
 *
 *   **Stop out (margin level ≤ 50%).** Close the single worst position, then look again. Each
 *   close frees that position's margin, so the level jumps and the account frequently survives
 *   with its other trades intact — which is why MT5 closes one at a time and not the book. Live
 *   now that `ACCOUNT_LEVERAGE` is finite; it goes inert again, with nothing else changing, if
 *   that constant returns to `Infinity`, since zero margin has no level to fall through.
 *
 *   **Equity ≤ 0.** The backstop under the stop out, and the only floor at all when margin is
 *   zero. There is no partial close that helps: closing a position realises exactly the loss it
 *   was already floating, so equity does not move. Everything closes, and the account stops.
 *
 * Afterwards the balance is squared at zero. See `settleNegativeBalance`.
 *
 * Returns the book unchanged — the same object — when nothing was breached, which is every
 * tick but one, so the store can skip the re-render.
 */
export function enforceMargin(
  book: Book,
  quotes: Record<string, QuoteState>,
  now: number
): Book {
  let next = book;

  // Bounded rather than `while`: a position on an instrument the feed has stopped quoting
  // cannot be closed, and an unbounded loop would spin on it forever inside the tick handler.
  for (let guard = 0; guard < 1000 && next.positions.length > 0; guard++) {
    const action = marginAction(accountSummary(next.balance, next.positions, quotes));
    if (action === 'none') break;

    if (action === 'blown') {
      next = liquidate(next, quotes, now);
      break;
    }

    const worst = worstPosition(next.positions, quotes);
    if (!worst) break;

    next = applyClose(next, worst, quotes[worst.symbol]!, now, 'stop-out', quotes);
  }

  return settleNegativeBalance(next, now);
}

/**
 * The position losing the most, which is the one MT5 closes first at a stop out.
 *
 * Positions with no quote are skipped rather than treated as flat: an unpriced position cannot
 * be closed at all, so nominating it would stall the stop-out loop on the one trade it is
 * unable to act on while the account kept falling.
 */
function worstPosition(
  positions: Position[],
  quotes: Record<string, QuoteState>
): Position | null {
  let worst: Position | null = null;
  let worstNet = Infinity;

  for (const position of positions) {
    const quote = quotes[position.symbol];
    if (!quote) continue;

    const net = positionNet(position, quote, quotes);
    if (net === null || net >= worstNet) continue;

    worst = position;
    worstNet = net;
  }

  return worst;
}

/**
 * Close the whole book at market, the way a broker does when there is nothing left.
 *
 * A position whose instrument has no current quote is left open rather than closed at an
 * invented price — the same rule `closeAll` follows, and for the same reason. It gets closed on
 * the tick that prices it, which is the first moment the loss is a fact rather than a guess.
 */
function liquidate(book: Book, quotes: Record<string, QuoteState>, now: number): Book {
  let next = book;

  for (const position of book.positions) {
    const quote = quotes[position.symbol];
    if (!quote) continue;

    next = applyClose(next, position, quote, now, 'stop-out', quotes);
  }

  return next;
}

/**
 * Negative balance protection: the account stops at zero, it does not go into debt.
 *
 * A liquidation fills at the price the market is actually at, and that price can be past the
 * point where equity hit zero — so the balance lands slightly (or, on a gap, badly) below it.
 * Real brokers square that with a compensating credit rather than invoicing the client, and
 * that is what this writes: a balance operation, visible in the ledger, labelled for what it
 * is instead of masquerading as a deposit the account holder made.
 *
 * Booked as a credit rather than by simply assigning `balance = 0` because the History screen
 * reconciles: deposit − withdrawal + profit + swap + commission has to equal the balance, and
 * silently moving the balance without a matching entry would break that identity in a way that
 * shows up as an unexplained few hundred dollars.
 *
 * Only fires with the book flat. While anything is still open the balance can be negative and
 * the account perfectly healthy — a winning position carrying it — and zeroing it there would
 * be handing out money.
 */
function settleNegativeBalance(book: Book, now: number): Book {
  if (book.positions.length > 0) return book;

  const balance = Math.round(book.balance * 100) / 100;
  if (balance >= 0) return book;

  const credit = Math.round(-balance * 100) / 100;

  const op: BalanceOp = {
    id: newId('bal'),
    ticket: book.nextTicket,
    time: now,
    amount: credit,
    note: 'Negative balance protection',
  };

  return touch({
    ...book,
    balance: 0,
    deposit: Math.round((book.deposit + credit) * 100) / 100,
    balanceOps: [...book.balanceOps, op],
    nextTicket: advanceTicket(book.nextTicket),
  });
}

/* ------------------------------------------------------------------ */
/*  Balance operations (deposit / withdrawal)                          */
/* ------------------------------------------------------------------ */

/**
 * Pay money in, or take money out.
 *
 * A balance operation is not a trade: it moves `balance` without creating a deal, which is
 * exactly how MT5 records a deposit. Deposits and withdrawals are accumulated separately so
 * the History summary still reconciles — deposit − withdrawal + profit + swap + commission
 * always equals the balance.
 *
 * A withdrawal is capped at free margin rather than at the balance. Money backing an open
 * position is not the account holder's to take, and letting it leave would put the account
 * straight into a margin call the moment the next tick arrived.
 */
export function adjustBalance(
  book: Book,
  delta: number,
  quotes: Record<string, QuoteState>,
  now: number = Date.now()
): { ok: true; book: Book } | { ok: false; error: string } {
  if (!Number.isFinite(delta)) return { ok: false, error: 'Enter a valid amount' };

  const amount = Math.round(delta * 100) / 100;
  if (amount === 0) return { ok: true, book };

  if (amount < 0) {
    const available = Math.round(freeMarginOf(book, quotes) * 100) / 100;
    if (-amount > available) {
      return { ok: false, error: `Only ${available.toFixed(2)} is free to withdraw` };
    }
  }

  const op: BalanceOp = {
    id: newId('bal'),
    ticket: book.nextTicket,
    time: now,
    amount,
  };

  return {
    ok: true,
    book: touch({
      ...book,
      balance: Math.round((book.balance + amount) * 100) / 100,
      deposit: amount > 0 ? Math.round((book.deposit + amount) * 100) / 100 : book.deposit,
      withdrawal:
        amount < 0 ? Math.round((book.withdrawal - amount) * 100) / 100 : book.withdrawal,
      balanceOps: [...book.balanceOps, op],
      nextTicket: advanceTicket(book.nextTicket),
    }),
  };
}

/** Set the balance outright — the same operation, expressed as a target rather than a delta. */
export function setBalance(
  book: Book,
  target: number,
  quotes: Record<string, QuoteState>,
  now: number = Date.now()
): { ok: true; book: Book } | { ok: false; error: string } {
  if (!Number.isFinite(target) || target < 0) {
    return { ok: false, error: 'Enter a valid amount' };
  }
  return adjustBalance(book, target - book.balance, quotes, now);
}

/* ------------------------------------------------------------------ */
/*  The tick loop                                                      */
/* ------------------------------------------------------------------ */

/**
 * Advance the book by one tick: trigger pending orders, hit stops, and accrue financing.
 *
 * Returns the same object when nothing happened, so the store can skip notifying React on the
 * overwhelming majority of ticks — only a fill, a stop or a rollover is a state change.
 */
export function processTick(
  book: Book,
  tick: Tick,
  quotes: Record<string, QuoteState>
): Book {
  let next = book;

  next = triggerOrders(next, tick, quotes);
  next = applyStops(next, tick, quotes);
  next = applySwap(next, tick);
  next = enforceMargin(next, quotes, tick.time);

  return next;
}

/**
 * Fill any pending order the tick has reached.
 *
 * Each type watches the side it would actually trade against — a buy stop is triggered by the
 * ask reaching it, not the bid — which is why a tight spread and a wide one behave differently
 * here, exactly as they do on a real account.
 */
function triggerOrders(book: Book, tick: Tick, quotes: Record<string, QuoteState>): Book {
  const due = book.orders.filter((order) => {
    if (order.symbol !== tick.symbol) return false;

    switch (order.kind) {
      case 'buy limit':
        return tick.ask <= order.price;
      case 'sell limit':
        return tick.bid >= order.price;
      case 'buy stop':
        return tick.ask >= order.price;
      case 'sell stop':
        return tick.bid <= order.price;
    }
  });

  if (due.length === 0) return book;

  let next = book;

  for (const order of due) {
    // Fill at the order's own price, not the tick's: a limit fills at its level or better,
    // and a stop is modelled without slippage.
    const market: PriceSnapshot =
      sideOf(order.kind) === 'buy'
        ? { ask: order.price, bid: order.price - (tick.ask - tick.bid) }
        : { bid: order.price, ask: order.price + (tick.ask - tick.bid) };

    const opened = openPosition(
      next,
      order.symbol,
      sideOf(order.kind),
      order.volume,
      market,
      quotes,
      tick.time,
      order.sl,
      order.tp,
      order.ticket
    );

    // An order the account can no longer afford is dropped rather than filled, which is what a
    // broker does — and it is recorded as cancelled so the reason is visible in the history.
    const base = opened.ok ? opened.book : next;

    next = {
      ...base,
      orders: base.orders.filter((o) => o.id !== order.id),
      orderHistory: [...base.orderHistory, settledRecord(order, tick.time, opened.ok ? 'filled' : 'cancelled')],
    };
  }

  return touch(next);
}

/**
 * Close positions whose stop loss or take profit the tick has reached.
 *
 * The comparison is against the price the position *closes* at — bid for a long, ask for a
 * short — so a long's stop is hit by the bid falling to it even while the ask is still above.
 */
function applyStops(book: Book, tick: Tick, quotes: Record<string, QuoteState>): Book {
  let next = book;

  for (const position of book.positions) {
    if (position.symbol !== tick.symbol) continue;

    const exit = position.type === 'buy' ? tick.bid : tick.ask;

    const hitSl =
      position.sl != null &&
      (position.type === 'buy' ? exit <= position.sl : exit >= position.sl);

    const hitTp =
      position.tp != null &&
      (position.type === 'buy' ? exit >= position.tp : exit <= position.tp);

    if (!hitSl && !hitTp) continue;

    // Stops fill at their own level, which is how a backtest stays reproducible.
    const level = hitSl ? position.sl! : position.tp!;
    next = applyClose(next, position, tick, tick.time, hitSl ? 'sl' : 'tp', quotes, level);
  }

  return next;
}

/** Charge overnight financing for any rollover this tick has carried the book past. */
function applySwap(book: Book, tick: Tick): Book {
  let changed = false;

  const positions = book.positions.map((position) => {
    if (position.symbol !== tick.symbol) return position;

    const { swap, lastSwapAt } = accrueSwap(position, tick.time);
    if (lastSwapAt === position.lastSwapAt) return position;

    changed = true;
    return {
      ...position,
      swap: Math.round((position.swap + swap) * 100) / 100,
      lastSwapAt,
    };
  });

  return changed ? touch({ ...book, positions }) : book;
}

