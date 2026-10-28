'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { marketStore, type QuoteState } from '@/lib/market/store';
import type { Tick } from '@/lib/market/types';
import { readSetting, writeSetting, booksKey, STORAGE_KEYS } from '@/lib/storage';
import { normalizeAccountKey } from '@/lib/accountKey';
import { accountStore } from '@/lib/account';
import { dbGet, dbSet } from '@/lib/db';
import {
  adjustBalance as engineAdjustBalance,
  cancelOrder as engineCancel,
  closeAll as engineCloseAll,
  closePosition as engineClose,
  defaultStops,
  enforceMargin,
  modifyPosition as engineModify,
  placeMarket,
  placePending,
  processTick,
  setBalance as engineSetBalance,
  type PriceSnapshot,
} from './engine';
import { planRewind } from './rewind';
import {
  emptyBook,
  isRealisticTicket,
  newTicketSeed,
  type BalanceOp,
  type Book,
  type Books,
  type Deal,
  type OrderRecord,
  type OrderRequest,
  type PendingOrder,
  type Position,
} from './types';

/* ------------------------------------------------------------------ */
/*  The account                                                        */
/* ------------------------------------------------------------------ */
/**
 * Owns the account and drives it from the market store's tick stream.
 *
 * There used to be two books, as MT5 keeps a live account separate from the Strategy Tester.
 * That split existed because the tester was a separate world entered by hand; now that the
 * whole terminal plays back stored data, there is no other world to be separate from — a trade
 * taken during playback is simply a trade on the account.
 *
 * Persistence is layered across three engines, each chosen for one property:
 *
 *   localStorage — balance, positions and orders only. Synchronous, so the Trade tab paints a
 *                  real account on the first render instead of flashing an empty one.
 *   IndexedDB    — the complete book, history included. No 5MB ceiling, so a long-running
 *                  account can no longer hit a silent write failure that takes the balance
 *                  with it.
 *   Upstash      — a debounced mirror keyed to the account number, so the same number on a
 *                  reinstalled PWA finds its positions waiting.
 *
 * The device is the source of truth in all three cases; the server copy is continuity, not
 * authority. See `persist` and `hydrateHistory`.
 *
 * ── One book per account number ──────────────────────────────────────
 *
 * All three layers are keyed by the account number. They used to be single-slot, and the
 * mirror was keyed to the shared login, so every device on earth wrote to the same server key
 * and people in different places watched each other's trades appear. The number is what names
 * an account, so it names the storage.
 *
 * Switching the number in Settings swaps the book rather than merging it, and the previous
 * account's copy is left on the device — so switching back is instant and works offline.
 */

/** What a fresh account starts with. */
const LIVE_DEPOSIT = 500;

/**
 * A brand-new account.
 *
 * `now` books the opening deposit as a dated ledger entry; omitting it leaves the money as a
 * bare total, which is what the pre-hydration placeholder wants. The placeholder is a class
 * field, so it is built at module load — reading the market clock there would mean one module's
 * import order deciding whether an account has a history, and it is replaced by `load()` before
 * anything renders anyway.
 */
function freshBooks(now = 0): Books {
  return { live: emptyBook(LIVE_DEPOSIT, now) };
}

/** Wait this long after the last change before mirroring to the server. */
const SYNC_DEBOUNCE_MS = 2500;

class TradingStore {
  private books: Books = freshBooks();
  private listeners = new Set<() => void>();
  private hydrated = false;

  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private detachTick: (() => void) | null = null;
  private detachMarket: (() => void) | null = null;

  /**
   * Set the moment anything is traded, deposited or withdrawn on this device this session.
   *
   * The server pull is asynchronous and can land seconds after launch, long after the user has
   * already acted. Once they have, the device's copy is the one they are looking at and the
   * remote copy — however its clock is stamped — must not be allowed to replace it.
   */
  private localDirty = false;

  /**
   * Which account's book is loaded, normalised. Null when the number is blank.
   *
   * Null means local-only: every server call is skipped rather than falling back to a shared
   * key, because a shared fallback is precisely the bug this replaced — two devices with no
   * account number set would find each other's trades again.
   */
  private account: string | null = null;

  private detachAccount: (() => void) | null = null;

  /**
   * The name of this book's slot on the device.
   *
   * Separate from `account` because the two answer different questions. `account` gates the
   * *server*, where a fallback would be the original bug — two devices with no number set
   * sharing a key again. This gates local storage, where the fallback is safe and necessary:
   * everything here is already private to one device, and returning early instead would mean a
   * user who cleared their account number silently stopped saving their trades at all.
   */
  private slot(): string {
    return this.account ?? 'local';
  }

  /** Set by `load` when it fell back to the pre-split key, so startup can make it durable. */
  private adoptedLegacy = false;

  /* ---------- subscription ---------- */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getBooks = (): Books => this.books;

  /** The book the user is currently trading — live account or tester. */
  getBook = (): Book => this.books.live;


  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  /* ---------- lifecycle ---------- */
  /**
   * Called from the first mounted view. Everything here is idempotent, so several screens
   * mounting at once still produce one hydration and one tick subscription.
   */
  init(): void {
    if (this.hydrated) return;
    this.hydrated = true;

    accountStore.hydrate();
    this.account = normalizeAccountKey(accountStore.getSnapshot().accountNumber);
    this.books = this.load(true);

    // Filed under the account's own key straight away. Left only in memory, the migration
    // would have to happen again on the next launch — and would stop happening at all once
    // the user had switched accounts once, since the flag is startup-only.
    if (this.adoptedLegacy) this.persist();

    // Changing the number in Settings is changing accounts, so the book has to follow it.
    this.detachAccount = accountStore.subscribe(() => {
      const next = normalizeAccountKey(accountStore.getSnapshot().accountNumber);
      if (next !== this.account) this.switchAccount(next);
    });

    // Balance and positions are already painted from the synchronous read above; the deal
    // history follows a tick later from IndexedDB, which is the only place it fits.
    void this.hydrateHistory(true);

    // Orders and stops are checked on the raw tick stream, not on a rendered frame.
    this.detachTick = marketStore.onTick(this.handleTick);

    // A backwards seek rewinds the clock past candles part of this book was built on. See
    // `rewindTo` — what survives is decided per row, not for the book as a whole.
    this.detachMarket = marketStore.onWipeRequired((toMs) => this.rewindTo(toMs));

    void this.pull();
    this.installFlushHandlers();
  }

  dispose(): void {
    this.detachTick?.();
    this.detachMarket?.();
    this.detachAccount?.();
    this.detachTick = null;
    this.detachMarket = null;
    this.detachAccount = null;
  }

  /**
   * Put down one account's book and pick up another's.
   *
   * The outgoing book is pushed first, synchronously scheduling nothing: a debounce still
   * pending when the number changes would otherwise fire *after* the switch and write the old
   * account's positions under the new account's key. That is the one ordering in here that can
   * corrupt data rather than merely lose a save.
   */
  private switchAccount(next: string | null): void {
    const leaving = this.account;

    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    if (leaving && this.localDirty) void this.push(leaving, this.books);

    this.account = next;
    this.localDirty = false;
    this.books = this.load(false);

    this.emit();
    void this.hydrateHistory(false);
    void this.pull();
  }

  /* ---------- the tick loop ---------- */
  private handleTick = (tick: Tick): void => {
    const book = this.books.live;
    const next = processTick(book, tick, marketStore.getQuotes());

    // processTick returns the same object when nothing happened, which is almost every tick.
    if (next === book) return;

    this.books = { ...this.books, live: next };
    this.persist();
    this.emit();
  };

  /* ---------- actions ---------- */
  /**
   * Place an order. Market orders fill immediately; limits and stops are parked until the
   * tick stream reaches them.
   */
  place(request: OrderRequest): { ok: true; ticket: number } | { ok: false; error: string } {
    // What the user was looking at wins over what the stream has moved on to. See `at`.
    const price = request.at ?? this.priceFor(request.symbol);
    if (!price) return { ok: false, error: 'No price for this instrument' };

    const book = this.books.live;
    const now = marketStore.getClock();

    const result =
      request.kind === 'market'
        ? placeMarket(book, request, price, marketStore.getQuotes(), now)
        : placePending(book, request, price, marketStore.getQuotes(), now);

    if (!result.ok) return result;

    this.commit(result.book);
    return { ok: true, ticket: result.ticket };
  }

  /** Convenience for the chart's one-tap SELL / BUY buttons. */
  /**
   * One tap from the chart's buy/sell buttons.
   *
   * Protection is attached for you. The ticket is where a trader chooses their own levels;
   * these buttons are the fast path, and a fast path that opens naked positions teaches the
   * wrong habit and leaves the chart with nothing to drag. Both levels are visible on the
   * chart the moment the trade exists, and moving them is a long press away.
   */
  quickTrade(
    symbol: string,
    side: 'buy' | 'sell',
    volume: number,
    at?: { bid: number; ask: number }
  ): { ok: true; ticket: number } | { ok: false; error: string } {
    const price = at ?? this.priceFor(symbol);
    if (!price) return { ok: false, error: 'No price for this instrument yet' };

    // Stops are measured from the price actually paid, so the distances on the chart are the
    // distances from the entry line and not from a tick that arrived a moment later.
    const entry = side === 'buy' ? price.ask : price.bid;
    const stops = defaultStops(symbol, side, entry);

    return this.place({ symbol, kind: 'market', side, volume, sl: stops.sl, tp: stops.tp, at: price });
  }

  /**
   * Move a position's stop or target — what dragging its line on the chart commits.
   *
   * Rejections are returned rather than thrown: a stop dragged through the price is an
   * ordinary thing to do by accident, and the caller puts the line back where it was.
   */
  modifyPosition(
    id: string,
    changes: { sl?: number | null; tp?: number | null }
  ): { ok: true } | { ok: false; error: string } {
    const result = engineModify(this.books.live, id, changes);
    if (!result.ok) return result;

    this.commit(result.book);
    return { ok: true };
  }

  closePosition(id: string): void {
    const book = this.books.live;
    const position = book.positions.find((p) => p.id === id);
    if (!position) return;

    const price = this.priceFor(position.symbol);
    if (!price) return;

    this.commit(engineClose(book, id, price, marketStore.getClock(), 'manual', marketStore.getQuotes()));
  }

  closeAll(symbol?: string): void {
    this.commit(
      engineCloseAll(
        this.books.live,
        marketStore.getQuotes(),
        marketStore.getClock(),
        symbol
      )
    );
  }

  cancelOrder(id: string): void {
    this.commit(engineCancel(this.books.live, id, marketStore.getClock()));
  }

  /**
   * Pay money in or take it out of the account currently being traded.
   *
   * Routed through the same `commit` as a fill, so the new balance is persisted, mirrored to
   * the server and visible to the margin check on the very next order — the deposited money
   * is tradable immediately.
   */
  adjustBalance(delta: number): { ok: true } | { ok: false; error: string } {
    // Stamped from the market clock, not the wall clock: a deposit made during a backtest
    // belongs on the tested day, the same rule every other record in the book follows.
    const result = engineAdjustBalance(
      this.books.live,
      delta,
      marketStore.getQuotes(),
      marketStore.getClock()
    );
    if (!result.ok) return result;

    this.commit(result.book);
    return { ok: true };
  }

  /** Same operation as a target figure, which is what the settings screen edits. */
  setBalance(target: number): { ok: true } | { ok: false; error: string } {
    const result = engineSetBalance(
      this.books.live,
      target,
      marketStore.getQuotes(),
      marketStore.getClock()
    );
    if (!result.ok) return result;

    this.commit(result.book);
    return { ok: true };
  }

  /**
   * Forget both books, here and on the server.
   *
   * Called by "delete local data" *before* the local keys are cleared. Order matters twice
   * over: a queued sync would otherwise fire after the wipe and write the old book straight
   * back, and a server copy left behind would be pulled down on the next launch.
   */
  async wipe(): Promise<void> {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }

    // A reset is a real account creation, so the opening deposit gets a dated ledger entry.
    this.books = freshBooks(marketStore.getClock());
    this.localDirty = false;
    this.emit();

    try {
      if (this.account) {
        await fetch(`/api/book?account=${encodeURIComponent(this.account)}`, { method: 'DELETE' });
      }
    } catch {
      // Offline. The device's copy is going regardless; the server's will lose on the next
      // write, since a fresh book is what this device now holds.
    }
  }

  /**
   * Roll the book back to a moment, after the session jumped backwards in time.
   *
   * This used to empty the account outright, which was heavier than the problem: a rewind
   * invalidates the part of a book that had not happened yet, not the book. The rule and the
   * arithmetic live in `planRewind`, because the chart's confirmation dialog has to describe
   * exactly what this is about to do — two implementations of that would eventually disagree,
   * and a dialog that miscounts is worse than none because it is believed.
   */
  rewindTo(toMs: number): void {
    const plan = planRewind(this.books.live, toMs);

    // The ordinary case once a session is running: scrubbing back over ground where nothing was
    // traded. No write, no re-render, and no `updatedAt` bump to beat a newer copy in a sync.
    if (!plan.changed) return;

    this.books = { ...this.books, live: plan.book };
    this.persist();
    this.emit();
  }

  /**
   * Persist and publish a new book — after the account's own rules have had their say.
   *
   * Every mutation funnels through here, which is the only place the margin floor can be
   * applied once rather than remembered at each of a dozen call sites. A manual close that
   * realises more than the balance, a withdrawal that empties the account, a fill whose spread
   * takes the last of the equity: all of them arrive here, and all of them get liquidated and
   * squared at zero by the same code the tick loop uses.
   *
   * `enforceMargin` returns the identical object when nothing was breached, so the ordinary
   * case costs one summary and no allocation.
   */
  private commit(book: Book): void {
    if (book === this.books.live) return;

    const settled = enforceMargin(book, marketStore.getQuotes(), marketStore.getClock());

    this.books = { ...this.books, live: settled };
    this.persist();
    this.emit();
  }

  private priceFor(symbol: string): PriceSnapshot | null {
    const quote: QuoteState | undefined = marketStore.getQuote(symbol);
    if (!quote) return null;
    return { bid: quote.bid, ask: quote.ask };
  }

  /* ---------- persistence ---------- */
  /**
   * Read the stored books, migrating a device that predates them.
   *
   * The terminal used to keep a bare positions array and a balance under separate keys. Those
   * are folded into the live book once and then ignored, so an existing install keeps whatever
   * it was showing instead of being reset to an empty account.
   */
  private load(allowLegacy: boolean): Books {
    this.adoptedLegacy = false;

    const stored = readSetting<Partial<Books> | null>(booksKey(this.slot()), null);

    if (stored?.live) return { live: normalizeBook(stored.live, LIVE_DEPOSIT) };

    /*
     * Nothing under this account's key. Only at startup, adopt whatever the device held back
     * when there was one slot for everything — that book belongs to whichever number the
     * device was using at the time, which is the number it starts up holding.
     *
     * `allowLegacy` is false for every later switch, and that is not a tidiness flag. Without
     * it, typing a number the device has never seen would hand the brand-new account the old
     * one's positions and history — the opposite of what a new account number means.
     *
     * Read and left in place. Deleting it would make the migration one-way, and the same
     * localStorage is read by an older build still installed on the same phone.
     */
    if (allowLegacy) {
      const legacy = readSetting<Partial<Books> | null>(STORAGE_KEYS.books, null);
      if (legacy?.live) {
        this.adoptedLegacy = true;
        return { live: normalizeBook(legacy.live, LIVE_DEPOSIT) };
      }
    }

    const books = freshBooks(marketStore.getClock());
    const legacyPositions = readSetting<Position[] | null>(STORAGE_KEYS.positions, null);
    const legacyBalance = readSetting<number | null>(STORAGE_KEYS.balance, null);

    if (legacyPositions?.length) {
      books.live.positions = legacyPositions.map((position, index) => ({
        ...position,
        ticket: position.ticket ?? index + 1,
        sl: position.sl ?? null,
        tp: position.tp ?? null,
        commission: position.commission ?? 0,
        swap: position.swap ?? 0,
        lastSwapAt: position.lastSwapAt ?? position.openTime ?? Date.now(),
      }));
      books.live.nextTicket = books.live.positions.length + 1;
      // Left small on purpose: `normalize` lifts the whole book in one shift below, and doing
      // it here as well would move the counter twice and open a gap the positions never had.
    }

    if (typeof legacyBalance === 'number') {
      books.live.balance = legacyBalance;
      books.live.deposit = legacyBalance;
    }

    return books;
  }

  /**
   * Restore the history that localStorage no longer carries.
   *
   * `load()` returns a book with empty `deals`, `orderHistory` and `balanceOps`, because the
   * hot slice on disk has them stripped. The full copy lives in IndexedDB; this splices it
   * back in once it resolves.
   *
   * Only the history is taken. Balance, positions and orders come from the synchronous read
   * or from whatever the user has already done this session — adopting those from here would
   * let a stale database read undo a fill that happened while it was in flight.
   */
  private async hydrateHistory(allowLegacy: boolean): Promise<void> {
    const account = this.account;

    let stored: Books | undefined;
    try {
      stored = await dbGet<Books>('books', this.slot());
      // Same startup-only adoption as `load()`, and withheld on a switch for the same reason.
      if (!stored?.live && allowLegacy) stored = await dbGet<Books>('books', 'books');
    } catch {
      return; // IndexedDB unavailable; the hot slice is all this device has, and it works.
    }
    if (!stored?.live) return;

    // The account changed while this read was in flight; the answer belongs to the old one.
    if (this.account !== account) return;

    const restore = (current: Book, saved: Book | undefined): Book =>
      saved
        ? {
            ...current,
            deals: current.deals.length ? current.deals : (saved.deals ?? []),
            orderHistory: current.orderHistory.length
              ? current.orderHistory
              : (saved.orderHistory ?? []),
            balanceOps: current.balanceOps.length ? current.balanceOps : (saved.balanceOps ?? []),
          }
        : current;

    this.books = { live: restore(this.books.live, stored.live) };
    this.emit();
  }

  /**
   * Write the books to the device, and mirror them to the server shortly after.
   *
   * Split across two engines, because the book has two halves with opposite needs.
   *
   * Balance and open positions must be readable during the *first render* — a Trade tab that
   * paints an empty account for a frame before filling it in looks like a lost account. That
   * needs localStorage, which is synchronous. It is also bounded: a few dozen rows at most.
   *
   * Deals and order history grow without bound and are only ever read by the History tab,
   * which can afford to wait a tick. Those go to IndexedDB, which has no 5MB ceiling — so the
   * silent write failure that used to take the balance with it after months of trading is
   * gone, and `trimHistory` becomes a last resort rather than an expected outcome.
   */
  private persist(): void {
    this.localDirty = true;

    // The complete book, history included. No ceiling, so this is the authoritative copy.
    void dbSet('books', this.slot(), this.books);

    if (writeSetting(booksKey(this.slot()), hotSlice(this.books))) {
      this.scheduleSync();
      return;
    }

    // The hot slice is small by construction, so a failure here means storage is refused
    // outright rather than full. Trim anyway and retry once before giving up.
    this.books = { live: trimHistory(this.books.live) };

    if (!writeSetting(booksKey(this.slot()), hotSlice(this.books))) {
      // Private mode or storage disabled. IndexedDB above and the server mirror below are
      // the remaining copies; the account is not lost, it just won't paint instantly.
      console.warn('Trading book could not be saved to this device.');
    }

    this.scheduleSync();
  }

  /* ---------- server mirror ---------- */
  /**
   * Pull the server's copy and take it only if it is genuinely newer.
   *
   * Last-writer-wins on `updatedAt`. That is the right rule here because one account can only
   * be signed in on one device at a time, so two books diverging is the reinstall case — and
   * in that case the most recent one is the one the user was actually trading.
   */
  private async pull(): Promise<void> {
    const account = this.account;
    if (!account) return;

    try {
      const res = await fetch(`/api/book?account=${encodeURIComponent(account)}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;

      const data: { books?: Books } = await res.json();
      if (!data.books?.live) return;

      // Switched accounts while the request was in flight — this answer is the other one's.
      if (this.account !== account) return;

      // The user has traded or deposited while this request was in flight. Their device is
      // now ahead of the server by definition — adopt nothing, and push instead.
      if (this.localDirty) {
        this.scheduleSync();
        return;
      }

      // Normalized first: a copy written before a field existed comes back without it, and a
      // missing number would poison every sum — and every margin check — it takes part in.
      const merged: Books = {
        live: pickNewer(this.books.live, normalizeBook(data.books.live, LIVE_DEPOSIT)),
      };

      this.books = merged;
      writeSetting(booksKey(this.slot()), merged);
      this.emit();
    } catch {
      // Offline, or no session. The local book is authoritative until the network returns.
    }
  }

  private scheduleSync(): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    const account = this.account;
    if (!account) return;

    this.syncTimer = setTimeout(() => void this.push(account, this.books), SYNC_DEBOUNCE_MS);
  }

  /**
   * Both arguments are passed rather than read from `this`.
   *
   * A push is asynchronous and the account can change under it. Capturing which book is going
   * to which key at the moment the push is *decided* is what stops a switch mid-flight from
   * filing one account's positions under another's number.
   */
  private async push(account: string, books: Books): Promise<void> {
    this.syncTimer = null;
    try {
      await fetch('/api/book', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, books }),
      });
    } catch {
      // The local copy already holds it; the next change will try again.
    }
  }

  /**
   * Flush on the way out.
   *
   * A phone backgrounding the PWA may never run another timer, so the debounce has to be
   * short-circuited when the page is hidden. sendBeacon is used because a normal fetch is
   * routinely killed mid-flight during unload.
   */
  private installFlushHandlers(): void {
    if (typeof document === 'undefined') return;

    const flush = () => {
      if (!this.syncTimer) return;
      clearTimeout(this.syncTimer);
      this.syncTimer = null;

      if (!this.account) return;

      try {
        const payload = JSON.stringify({ account: this.account, books: this.books });
        navigator.sendBeacon?.('/api/book', new Blob([payload], { type: 'application/json' }));
      } catch {
        /* nothing more we can do at unload */
      }
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
  }
}

/**
 * Coerce whatever came out of storage into a book the engine can trust.
 *
 * Both sources are outside this code's control: localStorage can hold a book written by an
 * older build, and the server's copy can be older still. A missing array or a balance that
 * arrives as `null` doesn't announce itself — it turns every downstream sum into `NaN`, and a
 * `NaN` free margin silently passes or fails margin checks at random. Every field is checked
 * rather than spread, so that can't happen.
 */
function normalizeBook(stored: Partial<Book> | undefined | null, deposit: number): Book {
  const base = emptyBook(deposit);
  if (!stored || typeof stored !== 'object') return base;

  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

  const positions = list<Position>(stored.positions);
  const orders = list<PendingOrder>(stored.orders);
  const balanceOps = list<BalanceOp>(stored.balanceOps);
  const deals = list<Deal>(stored.deals);

  const orderHistory = list<OrderRecord>(stored.orderHistory);

  // A ticket counter that has fallen behind what the book already contains would hand out
  // duplicates, so it is floored at one past the highest ticket in use.
  const highestTicket = [...positions, ...orders, ...deals, ...balanceOps].reduce(
    (max, row) => Math.max(max, num(row?.ticket, 0)),
    0
  );

  const raw = {
    balance: num(stored.balance, base.balance),
    deposit: num(stored.deposit, base.deposit),
    withdrawal: num(stored.withdrawal, 0),
    positions,
    orders,
    deals,
    orderHistory,
    balanceOps,
    nextTicket: Math.max(1, Math.floor(num(stored.nextTicket, 1)), highestTicket + 1),
    updatedAt: num(stored.updatedAt, 0),
  };

  return promoteTickets(raw);
}

/**
 * Lift a book whose tickets start at 1 into the range a broker would have issued.
 *
 * Every ticket moves by the same offset, which is the only way to do this that keeps what a
 * ticket means. Renumbering them independently — even into the right range — would scramble
 * their order, and the order is half the information: `#3105290764` is older than
 * `#3105290812` because the sequence only ever goes up. One offset preserves that, preserves
 * uniqueness, and keeps every gap where it was.
 *
 * `fromOrder` is carried along, because it is a ticket too — the pending order a position grew
 * out of. Shifting the orders and not the references to them would leave positions pointing at
 * tickets that no longer exist.
 *
 * Runs once. After it, everything in the book is above the floor and the check below is false
 * forever, so a book that has already been promoted is returned untouched — the same object,
 * so nothing re-renders for it.
 */
function promoteTickets(book: Book): Book {
  const lowest = [
    ...book.positions,
    ...book.orders,
    ...book.deals,
    ...book.orderHistory,
    ...book.balanceOps,
  ].reduce((min, row) => Math.min(min, row.ticket), Number.POSITIVE_INFINITY);

  // An empty book has nothing to lift; its counter alone decides.
  if (!Number.isFinite(lowest)) {
    return isRealisticTicket(book.nextTicket) ? book : { ...book, nextTicket: newTicketSeed() };
  }

  if (isRealisticTicket(lowest)) return book;

  // Anchored so the *lowest* existing ticket lands on the seed, which puts the whole book
  // inside the range rather than only the part of it above the offset.
  const offset = newTicketSeed() - lowest;
  const shift = <T extends { ticket: number }>(row: T): T => ({ ...row, ticket: row.ticket + offset });

  return {
    ...book,
    positions: book.positions.map((position) => ({
      ...shift(position),
      fromOrder: position.fromOrder === undefined ? undefined : position.fromOrder + offset,
    })),
    orders: book.orders.map(shift),
    deals: book.deals.map(shift),
    orderHistory: book.orderHistory.map(shift),
    balanceOps: book.balanceOps.map(shift),
    nextTicket: book.nextTicket + offset,
  };
}

/** How much closed history a single book keeps once storage starts pushing back. */
const TRIM_TO = 200;

/** Drop the oldest deals and settled orders. Positions and money are never touched. */
/**
 * The half of a book that has to survive in localStorage.
 *
 * Everything the Trade tab paints on first render, and nothing that grows: history is
 * deliberately emptied here, then restored from IndexedDB a tick later. See `persist`.
 */
function hotSlice(books: Books): Books {
  const strip = (book: Book): Book => ({
    ...book,
    deals: [],
    orderHistory: [],
    balanceOps: [],
  });
  return { live: strip(books.live) };
}

function trimHistory(book: Book): Book {
  if (book.deals.length <= TRIM_TO && book.orderHistory.length <= TRIM_TO) return book;
  return {
    ...book,
    deals: book.deals.slice(-TRIM_TO),
    orderHistory: book.orderHistory.slice(-TRIM_TO),
  };
}

/** A book that has never been written loses to one that has, regardless of clock skew. */
function pickNewer(local: Book, remote: Book | undefined): Book {
  if (!remote) return local;
  if (!remote.updatedAt) return local;
  if (!local.updatedAt) return remote;
  return remote.updatedAt > local.updatedAt ? remote : local;
}

export const tradingStore = new TradingStore();

/* ------------------------------------------------------------------ */
/*  React bindings                                                     */
/* ------------------------------------------------------------------ */

const SERVER_BOOK = emptyBook(LIVE_DEPOSIT);

/** The active book — the live account, or the tester's while a backtest is running. */
export function useBook(): Book {
  useEffect(() => {
    tradingStore.init();
  }, []);

  return useSyncExternalStore(tradingStore.subscribe, tradingStore.getBook, () => SERVER_BOOK);
}

/** Stable action handles, so a component can trade without re-subscribing to anything. */
export function useTrading() {
  const place = useCallback((request: OrderRequest) => tradingStore.place(request), []);
  const quickTrade = useCallback(
    (symbol: string, side: 'buy' | 'sell', volume: number, at?: { bid: number; ask: number }) =>
      tradingStore.quickTrade(symbol, side, volume, at),
    []
  );
  const closePosition = useCallback((id: string) => tradingStore.closePosition(id), []);
  const modifyPosition = useCallback(
    (id: string, changes: { sl?: number | null; tp?: number | null }) =>
      tradingStore.modifyPosition(id, changes),
    []
  );
  const closeAll = useCallback((symbol?: string) => tradingStore.closeAll(symbol), []);
  const cancelOrder = useCallback((id: string) => tradingStore.cancelOrder(id), []);
  const adjustBalance = useCallback((delta: number) => tradingStore.adjustBalance(delta), []);
  const setBalance = useCallback((target: number) => tradingStore.setBalance(target), []);

  return {
    place,
    quickTrade,
    closePosition,
    modifyPosition,
    closeAll,
    cancelOrder,
    adjustBalance,
    setBalance,
  };
}
