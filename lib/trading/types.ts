/* ------------------------------------------------------------------ */
/*  Trading domain                                                     */
/* ------------------------------------------------------------------ */
/**
 * The account book: what is open, what is waiting, and what has closed.
 *
 * Every timestamp in here is taken from the tick that caused it, never from `Date.now()`.
 * That is the single rule which lets the same engine drive live trading and a backtest of
 * 2026-05-01 — in replay the ticks carry simulated time, so a position opened during a test
 * is stamped with test time and its history reads correctly afterwards.
 */

export type Side = 'buy' | 'sell';

/** The four pending order types MT5 offers, spelled as it spells them. */
export type PendingKind = 'buy limit' | 'sell limit' | 'buy stop' | 'sell stop';

export type OrderKind = 'market' | PendingKind;

/** Which way a pending order resolves once it triggers. */
export function sideOf(kind: PendingKind): Side {
  return kind.startsWith('buy') ? 'buy' : 'sell';
}

export interface Position {
  id: string;
  /** MT5-style increasing ticket number, shown in the position detail. */
  ticket: number;
  /** Canonical instrument ("XAUUSD") — never the broker-suffixed display name. */
  symbol: string;
  type: Side;
  volume: number;
  openPrice: number;
  /** Unix ms, from the opening tick. */
  openTime: number;
  sl: number | null;
  tp: number | null;
  commission: number;
  swap: number;
  /** Last rollover already charged, so reopening the app can't double-bill. */
  lastSwapAt: number;
  /** Ticket of the pending order this grew out of, when it wasn't a market order. */
  fromOrder?: number;
}

export interface PendingOrder {
  id: string;
  ticket: number;
  symbol: string;
  kind: PendingKind;
  volume: number;
  /** The trigger price. */
  price: number;
  sl: number | null;
  tp: number | null;
  placedTime: number;
}

/** Why a position stopped existing. Drives the History screen's wording. */
export type CloseReason = 'manual' | 'sl' | 'tp' | 'close-all' | 'stop-out';

export interface Deal {
  id: string;
  ticket: number;
  symbol: string;
  type: Side;
  volume: number;
  openPrice: number;
  closePrice: number;
  openTime: number;
  closeTime: number;
  profit: number;
  commission: number;
  swap: number;
  reason: CloseReason;
  /**
   * The protective orders the position was carrying when it closed.
   *
   * Recorded so a rewind past this close can hand the position back intact. Without them the
   * only options were to delete a trade that was genuinely open at the rewound moment, or to
   * reopen it stop-less — losing a trade is visible, losing its stop is not, so the field
   * exists rather than the choice.
   *
   * Optional because deals written before this field existed do not have it. `undefined` means
   * "never recorded" and is what marks a deal as un-reopenable; `null` means "recorded, and
   * there was no stop", which reopens perfectly well.
   */
  sl?: number | null;
  tp?: number | null;
}

/** A pending order that is no longer pending — filled, or cancelled by the user. */
export interface OrderRecord {
  id: string;
  ticket: number;
  symbol: string;
  kind: PendingKind;
  volume: number;
  price: number;
  placedTime: number;
  settledTime: number;
  outcome: 'filled' | 'cancelled';
  /** As on `Deal`, and for the same reason — see there. */
  sl?: number | null;
  tp?: number | null;
}

/**
 * A deposit or a withdrawal.
 *
 * MT5 books these as deals of type "balance" — they carry a ticket and sit in the history
 * alongside trades, which is what makes an account's money traceable rather than just a
 * number that changed. Positive is money in, negative is money out.
 */
export interface BalanceOp {
  id: string;
  ticket: number;
  /** Unix ms, from the same clock the book's trades use. */
  time: number;
  amount: number;
  /**
   * What this operation was, when it was not a plain deposit or withdrawal.
   *
   * Only the broker writes one: the negative-balance credit that squares an account whose
   * stop-out filled below zero is a deposit in every arithmetic sense, and the summary has to
   * count it as one for `deposit − withdrawal + profit` to still reconcile — but calling it
   * "Deposit" in the ledger would claim the account holder paid it in. Optional because every
   * operation written before this field existed is a genuine deposit or withdrawal.
   */
  note?: string;
}

export interface Book {
  /** Realised money. Open P/L is never folded in here — that's equity. */
  balance: number;
  /** Everything ever paid in, so History can show the deposit line. */
  deposit: number;
  /** Everything ever taken out. Deposit − withdrawal + realised P/L === balance. */
  withdrawal: number;
  positions: Position[];
  orders: PendingOrder[];
  deals: Deal[];
  orderHistory: OrderRecord[];
  /** Deposits and withdrawals, oldest first. */
  balanceOps: BalanceOp[];
  nextTicket: number;
  /** Wall-clock ms of the last mutation. Decides the winner when syncing devices. */
  updatedAt: number;
}

/**
 * The persisted envelope around the one book.
 *
 * The key is still `live` because that is what every device and server copy written before the
 * strategy tester was removed uses, and renaming it would orphan those accounts. There is
 * nothing beside it any more.
 */
export interface Books {
  live: Book;
}

/* ------------------------------------------------------------------ */
/*  Ticket numbers                                                     */
/* ------------------------------------------------------------------ */
/**
 * Where an account's tickets start.
 *
 * They used to start at 1, which is the only wrong answer. A ticket is a handle into the
 * broker's own order table — every account on the server draws from the same sequence — so a
 * real one is a ten-digit number in the billions, and `#3` under a position is the single
 * detail that says loudest this is not a broker. Nobody's first trade is ticket one.
 *
 * The window below is the shape MT5 tickets actually take: ten digits, first digit 1–4. Drawn
 * once per account and then simply incremented, because a ticket has to keep its two real
 * properties — unique within the book, and increasing with time, so `#3105290764` is
 * demonstrably older than `#3105290812`. Randomising each one would break both.
 */
const TICKET_MIN = 1_000_000_000;
const TICKET_SPAN = 3_000_000_000;

export function newTicketSeed(): number {
  const source = globalThis.crypto;

  if (source?.getRandomValues) {
    // Rejection sampling, as for the account number: a raw modulus over a 32-bit draw makes low
    // values measurably likelier, and two accounts landing on the same seed is two books whose
    // tickets collide if they are ever compared.
    const ceiling = Math.floor(0xffffffff / TICKET_SPAN) * TICKET_SPAN;
    const buffer = new Uint32Array(1);

    for (let attempt = 0; attempt < 16; attempt += 1) {
      source.getRandomValues(buffer);
      if (buffer[0] < ceiling) return TICKET_MIN + (buffer[0] % TICKET_SPAN);
    }
  }

  return TICKET_MIN + Math.floor(Math.random() * TICKET_SPAN);
}

/** Whether a ticket looks like a broker's or like a counter that started at one. */
export function isRealisticTicket(ticket: number): boolean {
  return Number.isFinite(ticket) && ticket >= TICKET_MIN;
}

/**
 * The next ticket the broker would hand out — a jump, not an increment.
 *
 * `+1` is the giveaway. On a real server the sequence is shared by every account on it, so the
 * numbers either side of yours belong to strangers; two of your own trades a minute apart come
 * back thousands of tickets apart. A book whose tickets read ...764, ...765, ...766 has a real
 * ticket's *length* and a counter's behaviour, which is a worse tell than starting at 1 was,
 * because it looks right until you read two rows.
 *
 * Still strictly increasing, which is the part that cannot be given up: a ticket has to be
 * unique in the book, and it has to sort by age, because the whole history is read in that
 * order. Random *steps* keep both. Random *values* would keep neither — two draws can collide,
 * and nothing would say which trade came first.
 *
 * Up to four thousand a step, so a hundred trades move the sequence a couple of hundred
 * thousand and the number stays ten digits for the life of any account here.
 */
const TICKET_STEP_MAX = 4_000;

export function advanceTicket(current: number): number {
  const source = globalThis.crypto;
  const buffer = new Uint32Array(1);

  const draw =
    source?.getRandomValues
      ? (source.getRandomValues(buffer), buffer[0] / 0x100000000)
      : Math.random();

  return current + 1 + Math.floor(draw * TICKET_STEP_MAX);
}

/**
 * A new account, with its opening deposit booked as a ledger entry rather than as a bare number.
 *
 * The opening money used to land in `deposit` with no `BalanceOp` behind it, which left History
 * unable to say where it came from: the summary read "Deposit 500.00" with no D- row under it,
 * and the stamp beside the balance — which dates the newest ledger entry — had nothing to read
 * and printed a dash. A freshly reset account therefore looked like one whose money had arrived
 * from nowhere at no particular time.
 *
 * MT5 books an opening deposit as a balance deal like any other, and so does this now.
 *
 * `now` defaults to 0, which skips the entry entirely. That is not laziness: `emptyBook` is
 * called at module scope for the server-render fallback and again inside `normalizeBook` purely
 * for its default *scalars*, and neither may depend on a clock. Only the store, creating a real
 * account, passes a time.
 *
 * The totals are untouched either way, so History's identity still holds:
 * deposit − withdrawal + profit + swap + commission = balance. The entry explains the deposit;
 * it does not add to it.
 */
export function emptyBook(deposit: number, now = 0): Book {
  const ticket = newTicketSeed();
  const opening: BalanceOp[] =
    now > 0 && deposit > 0
      ? [{ id: `bal-open-${ticket.toString(36)}`, ticket, time: now, amount: deposit }]
      : [];

  return {
    balance: deposit,
    deposit,
    withdrawal: 0,
    positions: [],
    orders: [],
    deals: [],
    orderHistory: [],
    balanceOps: opening,
    nextTicket: opening.length ? advanceTicket(ticket) : ticket,
    updatedAt: 0,
  };
}

/* ---------- order entry ---------- */

export interface OrderRequest {
  symbol: string;
  kind: OrderKind;
  /**
   * Which way to trade. Required for a market order; for a pending order it is implied by the
   * kind ("buy limit" is always a buy) and any value here is ignored.
   */
  side?: Side;
  volume: number;
  /** Required for pending orders, ignored for market ones. */
  price?: number;
  sl?: number | null;
  tp?: number | null;
  /**
   * The exact bid and ask the user was looking at when they committed.
   *
   * A market order fills here rather than at whatever the tick stream has moved on to. The
   * quote board updates four times a second, so between the frame that painted 3419.62 on the
   * BUY button and the finger landing on it, the engine's own copy has usually changed — and a
   * trade that fills at a price the user never saw is the thing that makes a simulator feel
   * fake. What is on the button is what is bought.
   *
   * Omitted by anything that has no displayed price to honour, which then falls back to the
   * current quote.
   */
  at?: { bid: number; ask: number };
}

export type OrderResult =
  | { ok: true; book: Book; ticket: number }
  | { ok: false; error: string };

/* ---------- volume ---------- */
/**
 * The fallback lot spec, for a symbol in neither the table nor the broker's catalogue.
 *
 * These used to be *the* spec — one min, one max, one step for everything tradeable — which is
 * the thing that made a lot mean different amounts of risk under the same number. The real
 * figures are per instrument and always were, sitting unused on the catalogue entry. See
 * `volumeSpec` in ./math, which is what every caller asks now.
 */
export const MIN_VOLUME = 0.01;
export const MAX_VOLUME = 1000;
export const VOLUME_STEP = 0.01;
