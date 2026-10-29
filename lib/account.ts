'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { booksKey, readSetting, writeSetting } from './storage';
import { normalizeAccountKey } from './accountKey';
import { findInstrument, normalizeSymbol } from '@/lib/instruments';
import { DEPOSIT_CURRENCY } from '@/lib/trading/math';

/* ------------------------------------------------------------------ */
/*  Account, broker and symbol-naming configuration                    */
/* ------------------------------------------------------------------ */
/**
 * What the terminal *presents*: who the account belongs to, which broker and server it sits
 * on, and how that broker names its instruments.
 *
 * The symbol suffix is the subtle part. Brokers sell the same instrument under different
 * account types — XAUUSDm on micro, XAUUSDc on cent, XAUUSD.pro on a pro account — but that
 * suffix is a *label*, not an identity. Everything that resolves data speaks the canonical
 * name ("XAUUSD"), so the suffix is applied at the point of rendering and never anywhere a
 * symbol is used to request data, match an instrument, or key a series.
 *
 * The suffix configured here is the only one ever shown. Whatever name the feed reports for
 * an instrument is stripped back to the canonical body first, so the account type chosen in
 * settings — built-in or custom — is what every screen displays. See `brokerSymbol` below.
 */

export interface AccountConfig {
  /** Account holder, shown on the settings header card. */
  holderName: string;
  brokerName: string;
  accountNumber: string;
  /** Trade server, e.g. "Exness-MT5Trial9". */
  serverName: string;
  /** Server location line, e.g. "Access Point #1". */
  serverLocation: string;
  /**
   * The ledger identifier, without its leading D/W — e.g. `EXNESSMT5TRIAL9-USD-32914776`.
   *
   * Blank means "work it out", and what it works out to is the same thing composed from the
   * server, the deposit currency and the account number. Typed, it wins: brokers name accounts
   * in shapes no rule reproduces, and the one place that string is read is a row claiming to
   * quote what the server wrote.
   */
  accountLabel: string;
  /**
   * The comment carried by every open position — what MT5 shows under a trade's stop and
   * target. Blank means no comment, and no line for one.
   *
   * One setting rather than a field on each position, because that is what it models: a comment
   * is written by whatever *placed* the trade — an EA, a signal provider, the broker's own
   * bridge — so every trade from the same source carries the same string. A per-trade comment
   * would be a per-trade text box, which is a thing nobody fills in twice.
   *
   * Capped at `MAX_TRADE_COMMENT`. See there.
   */
  tradeComment: string;

  /* ---------- automated trading ---------- */
  /**
   * Whether the terminal trades the chart by itself.
   *
   * The one switch everything else here hangs off. Off is manual: the account only moves when a
   * button is pressed, which is what it has always done. On, `lib/trading/autotrader.ts` presses
   * the same buttons — literally the same calls — on a cadence set by the five fields below.
   *
   * Never inferred from the other settings. A configured hold range is not consent to trade,
   * and an account that started trading because a number was left in a box would be the worst
   * bug this feature could have.
   */
  autoTrade: boolean;
  /** Shortest a bot trade is held, in session seconds. */
  autoMinHoldSec: number;
  /** Longest a bot trade is held. Clamped to `AUTO_MAX_HOLD_SEC`. */
  autoMaxHoldSec: number;
  /** Average wait between one move closing and the next being looked for. */
  autoGapSec: number;
  /** How many positions open together on a move. */
  autoPositionsPerMove: number;
  /** Lot size per position, normalised to the instrument before it is sent. */
  autoVolume: number;

  /** Broker suffix appended to displayed instrument names. "" means no suffix. */
  symbolSuffix: string;
  /** Suffixes the user has added beyond the built-in account types. */
  customSuffixes: string[];
}

export const DEFAULT_ACCOUNT: AccountConfig = {
  holderName: 'PhantomPip Pro',
  brokerName: 'Exness Technologies Ltd',
  // Blank on purpose: `hydrate` issues every install its own number (see there).
  accountNumber: '',
  serverName: 'Exness-MT5Trial10',
  serverLocation: 'Access Point #1',
  accountLabel: '',
  tradeComment: '',

  // Off, and off is the only safe default: a mode that trades an account is not something a
  // user should discover having happened.
  autoTrade: false,
  autoMinHoldSec: 20,
  autoMaxHoldSec: 180,
  // No pause between moves: the next one is read for on the tick after the last one closed.
  autoGapSec: 0,
  autoPositionsPerMove: 1,
  autoVolume: 0.01,

  symbolSuffix: 'm',
  customSuffixes: [],
};

/** The number every install used to share before each one was issued its own. */
const LEGACY_DEFAULT_ACCOUNT = '89341200';

/** The account types brokers most commonly ship. Micro is the default. */
export const BUILT_IN_SUFFIXES: { value: string; label: string; note: string }[] = [
  { value: 'm', label: 'Micro', note: 'XAUUSDm' },
  { value: 'c', label: 'Cent', note: 'XAUUSDc' },
  { value: '.pro', label: 'Pro', note: 'XAUUSD.pro' },
  { value: '.ecn', label: 'ECN', note: 'XAUUSD.ecn' },
  { value: '', label: 'Standard', note: 'XAUUSD' },
];

const STORAGE_KEY = 'account.config';

/* ------------------------------------------------------------------ */
/*  Issuing an account number                                          */
/* ------------------------------------------------------------------ */
/**
 * A number for a device that has never had one.
 *
 * This exists because the default used to be a literal, `515995307`, and every field in the
 * app keys off the account number. So every fresh install was the same account: different
 * people in different countries opened the app and read each other's positions, because as far
 * as storage was concerned they were one trader. Separating the books did not fix that on its
 * own — a per-account key is worth nothing while everyone arrives holding the same key.
 *
 * Nine digits, which is the shape MT5 accounts actually take, drawn from the platform CSPRNG.
 * That is 900 million values: for a thousand devices the chance any two collide is about one
 * in two thousand, and a collision is recoverable in any case because the number is editable.
 * `Math.random` is the fallback rather than the default because its entropy is unspecified and
 * some engines seed it per-page, which is exactly the failure this is meant to avoid.
 */
const ACCOUNT_MIN = 100_000_000;
const ACCOUNT_SPAN = 900_000_000;

function newAccountNumber(): string {
  const source = globalThis.crypto;

  if (source?.getRandomValues) {
    // Rejection sampling. Taking the modulus of a raw 32-bit draw would make the low values
    // measurably likelier, and a skewed distribution means more collisions than the arithmetic
    // above promises — which is the one property this function has to deliver.
    const ceiling = Math.floor(0xffffffff / ACCOUNT_SPAN) * ACCOUNT_SPAN;
    const buffer = new Uint32Array(1);

    // Bounded, so a pathological RNG cannot hang the app. Expected iterations: one.
    for (let attempt = 0; attempt < 16; attempt += 1) {
      source.getRandomValues(buffer);
      if (buffer[0] < ceiling) return String(ACCOUNT_MIN + (buffer[0] % ACCOUNT_SPAN));
    }
  }

  return String(ACCOUNT_MIN + Math.floor(Math.random() * ACCOUNT_SPAN));
}

/**
 * Strip whatever suffix a name arrived with, leaving the canonical body.
 *
 * Names reach the UI from several places — the table, the broker's catalogue, a stored
 * watchlist written under an older setting — and some of them carry the broker's own suffix.
 * Only the settings suffix is allowed to show, so any incoming one is removed first.
 *
 * A suffix is only cut when what's left is an instrument the app can actually resolve, so a
 * canonical name that happens to end in the same letters ("USDCAD" against a custom "D") is
 * left alone. Longest match first: ".ecn" must win over any single-letter suffix.
 */
function bareSymbol(name: string, config: AccountConfig): string {
  const raw = String(name ?? '').trim().toUpperCase();

  const candidates = [...config.customSuffixes, ...BUILT_IN_SUFFIXES.map((s) => s.value)]
    .filter(Boolean)
    .map((s) => s.toUpperCase())
    .sort((a, b) => b.length - a.length);

  for (const suffix of candidates) {
    if (raw.length <= suffix.length || !raw.endsWith(suffix)) continue;
    const body = raw.slice(0, -suffix.length);
    if (findInstrument(body)) return normalizeSymbol(body);
  }

  return normalizeSymbol(raw);
}

/**
 * The name to show for an instrument — **display only**.
 *
 * Never feed the result back into anything that resolves data: `findInstrument`, the market
 * store, the feeds, or the picker's matching. Those all speak the canonical name ("XAUUSD"),
 * and a suffixed string would simply fail to resolve.
 *
 * This setting is the authority on naming, not the feed. The broker's catalogue does report
 * what it calls each instrument, and that name is still kept on the spec for support, but it
 * is deliberately *not* used here: an account configured as Micro shows XAUUSDm across every
 * screen even if the terminal it is bridged to calls the same instrument something else.
 */
export function brokerSymbol(symbol: string, config: AccountConfig): string {
  return bareSymbol(symbol, config) + config.symbolSuffix;
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */
/**
 * Shared and reactive: settings edited in the modal must reach the chart, trade and history
 * screens immediately, so this can't be per-component `useState`.
 */
class AccountStore {
  private config: AccountConfig = DEFAULT_ACCOUNT;
  private listeners = new Set<() => void>();
  private hydrated = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AccountConfig => this.config;

  /** Server render has no localStorage, so it always sees the defaults. */
  getServerSnapshot = (): AccountConfig => DEFAULT_ACCOUNT;

  /** Called from an effect, so stored values are applied after hydration, never during it. */
  hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;

    const stored = readSetting<Partial<AccountConfig> | null>(STORAGE_KEY, null);

    // Merged rather than replaced, so a config saved before a new field existed still loads.
    const merged: AccountConfig = { ...DEFAULT_ACCOUNT, ...(stored ?? {}) };

    /*
     * Issued here, once, and written down immediately.
     *
     * Two devices reach this with no number: a genuinely new install, and an existing one that
     * never opened Settings — the old default was never persisted, so those devices were all
     * running as `515995307` without ever having chosen it. Both get their own number, and the
     * existing one keeps its trades, because the book migration reads the pre-split key into
     * whatever number the device is holding at startup.
     */
    if (!normalizeAccountKey(merged.accountNumber)) {
      // `89341200` used to be the hard-coded default, which made every fresh install share one
      // server-side book. A device already trading under it keeps it; everyone else gets their own.
      const legacy = readSetting(booksKey(LEGACY_DEFAULT_ACCOUNT), null) ? LEGACY_DEFAULT_ACCOUNT : '';
      merged.accountNumber = legacy || newAccountNumber();
      writeSetting(STORAGE_KEY, merged);
    }

    this.config = merged;
    this.emit();
  }

  save(config: AccountConfig): void {
    this.config = config;
    writeSetting(STORAGE_KEY, config);
    this.emit();
  }

  /**
   * Back to defaults, except the number.
   *
   * Resetting settings is not becoming somebody else. The number names the book, the
   * watchlist and everything else filed against it, so clearing it would strand all of that
   * behind a number the user no longer has.
   */
  reset(): void {
    this.save({ ...DEFAULT_ACCOUNT, accountNumber: this.config.accountNumber });
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export const accountStore = new AccountStore();

export function useAccount(): AccountConfig {
  useEffect(() => {
    accountStore.hydrate();
  }, []);

  return useSyncExternalStore(
    accountStore.subscribe,
    accountStore.getSnapshot,
    accountStore.getServerSnapshot
  );
}

/** Convenience for screens that only need the display transform. */
export function useBrokerSymbol(): (display: string) => string {
  const config = useAccount();
  return (display: string) => brokerSymbol(display, config);
}

/* ------------------------------------------------------------------ */
/*  Generated copy                                                     */
/* ------------------------------------------------------------------ */
/**
 * The two preview lines on the Settings screen, and why neither is a setting.
 *
 * Both used to be editable. The News line was a free-text field, which meant every install
 * showed the same sentence until someone thought to change it, and the one who did was typing
 * a headline into a settings form — a chore with no right answer, for a line that is meant to
 * be whatever the feed last carried. Mailbox was already derived, and derived was right.
 *
 * So both are generated. Not with `Math.random()`, which would deal a different sentence on
 * every render and make the row flicker as the screen repainted, but from the account number:
 * one draw, fixed for the life of the account, different for the next one. That is what a
 * preview line is — a thing that was true when the account was opened and stays put until
 * something replaces it.
 */

/**
 * Trading Central's house register, which is what MT5's own feed carries: an instrument, a
 * venue, a horizon and a bias, cut off mid-thought the way a preview is.
 */
const NEWS_PREVIEWS: readonly string[] = [
  'Dow Jones (CME) (U6) intraday: 5...',
  'Gold (COMEX) intraday: the upside prevails ab...',
  'EUR/USD intraday: rebound towards 1.09...',
  'Brent Crude (ICE) intraday: bearish bias below...',
  'USD/JPY intraday: key resistance at 156.4...',
  'S&P 500 (CME) (U6) intraday: the RSI is mixed w...',
  'Bitcoin (CME) intraday: further advance expec...',
  'GBP/USD intraday: turning down below 1.27...',
];

/**
 * What a broker actually sends. Half of it is housekeeping, which is the half that makes the
 * other half believable — an inbox of nothing but welcome letters reads as a stage set.
 */
const MAILBOX_SUBJECTS: readonly ((broker: string) => string)[] = [
  (broker) => `Account registration - ${broker}`,
  (broker) => `Welcome to ${broker} - getting started`,
  (broker) => `${broker}: trading schedule update`,
  () => 'Swap rates revision effective Monday',
  () => 'Margin requirements update for metals',
  (broker) => `${broker}: scheduled server maintenance`,
  () => 'Your month-end statement is ready',
  (broker) => `${broker}: holiday trading hours`,
];

/**
 * Deal one item from a list, the same way every time for the same account.
 *
 * FNV-1a over the seed. Any cheap hash would do; what matters is that the whole seed is mixed
 * rather than, say, its last digit — account numbers are sequential-ish, and a weak hash would
 * hand consecutive accounts the same sentence.
 *
 * `salt` goes in at the *front* of the input rather than into the starting state, so the two
 * lists genuinely decorrelate. Seeding the state with it instead flips one bit before the
 * avalanche has anything to avalanche, and the two draws come out locked together: every
 * account that got the gold headline also got the same inbox subject, which reads as one
 * choice wearing two hats rather than two independent ones.
 */
function pick<T>(list: readonly T[], seed: string, salt: number): T {
  const input = `${salt}:${seed}`;
  let hash = 0x811c9dc5;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return list[hash % list.length];
}

/** The preview line under the News row. */
export function newsSubtitle(config: AccountConfig): string {
  return pick(NEWS_PREVIEWS, config.accountNumber, 0);
}

/**
 * The preview line under the Mailbox row.
 *
 * Takes the broker's name where the subject has room for it, so changing the broker in Settings
 * re-addresses the mail rather than leaving it signed by whoever was there before.
 */
export function mailboxSubtitle(config: AccountConfig): string {
  return pick(MAILBOX_SUBJECTS, config.accountNumber, 1)(config.brokerName);
}

/**
 * The account's own name, as MT5 writes it on a balance operation.
 *
 * MT5 files a deposit as a deal of type "balance" and shows that deal's *comment* under it. For
 * the funding of a demo account the comment the server writes is the account's name, which is
 * why the History ledger reads `D-UGMOBILE-USD-1566056226822` under the opening balance rather
 * than the word "Deposit" — the line identifies which account the money went into, on a
 * platform where one login can hold several.
 *
 * Composed from the same four things MT5 composes it from, in the same order:
 *
 *   `D`        demo, which every account here is — nothing is being traded for real money
 *   server     the trade server, minus the `-MT5` platform tag it always carries
 *   currency   the deposit currency, taken from the trading math so there is one definition
 *   number     the account number
 *
 * Returns `''` with no number set. That state lasts one frame before hydration, and a
 * half-formed identifier reads as a bug, whereas nothing at all reads as not-yet — callers fall
 * back to plain wording for it.
 */
export function accountBody(config: AccountConfig): string {
  const typed = config.accountLabel.trim();
  if (typed) return typed;

  const number = config.accountNumber.trim();
  if (!number) return '';

  const server = config.serverName
    .replace(/[-_\s]*mt5$/i, '')
    .replace(/[^A-Za-z0-9]+/g, '')
    .toUpperCase();

  return `${server || 'DEMO'}-${DEPOSIT_CURRENCY}-${number}`;
}

/**
 * What the leading letter says.
 *
 * `D` for money in, `W` for money out — so the History ledger states, on the row itself, which
 * direction the operation went. The amount's sign and colour already say it; carrying it in the
 * identifier too is what makes a run of rows scannable as *this account has been withdrawn
 * from*, which a column of differently-coloured numbers does not.
 *
 * Worth knowing, since the format is borrowed from real terminals: MT5's own `D-` means Demo,
 * not Deposit — it marks the account type, and a withdrawal on a demo account still reads `D-`.
 * The scheme below is deliberately not that one.
 */
export type LedgerDirection = 'deposit' | 'withdrawal';

export function ledgerPrefix(direction: LedgerDirection): string {
  return direction === 'deposit' ? 'D' : 'W';
}

/** The account's name as the header states it: the identity, which is the funded one. */
export function accountName(config: AccountConfig): string {
  const body = accountBody(config);
  return body ? `${ledgerPrefix('deposit')}-${body}` : '';
}

/** The name a single balance operation is filed under, lettered by its direction. */
export function balanceOpName(config: AccountConfig, amount: number): string {
  const body = accountBody(config);
  if (!body) return '';
  return `${ledgerPrefix(amount < 0 ? 'withdrawal' : 'deposit')}-${body}`;
}

/** The header's value, for components. */
export function useAccountName(): string {
  return accountName(useAccount());
}

/**
 * How long a trade comment may be.
 *
 * Thirty-one characters, which is not a design choice — it is the length MT5 allows, and the
 * length the servers behind it store. A longer string does not arrive truncated at the broker,
 * it arrives truncated *somewhere*, and a comment that reads differently on the terminal than
 * in the trade log is worse than one that was too short to begin with.
 *
 * It happens to be a good limit anyway: this is a line on a card, not a note field, and past
 * about thirty characters it wraps and starts pushing the position's own figures apart.
 */
export const MAX_TRADE_COMMENT = 31;

/** Clamp a comment to what a trade can actually carry. */
export function normalizeTradeComment(comment: string): string {
  return comment.trim().slice(0, MAX_TRADE_COMMENT);
}

/* ------------------------------------------------------------------ */
/*  Automated trading settings                                         */
/* ------------------------------------------------------------------ */
/**
 * The bounds the settings screen offers and the engine trusts.
 *
 * Fifteen minutes is the ceiling on a hold because that is the horizon you asked for, and it is
 * also where the premise stops being true: the lookahead reads the archive to check a move pays,
 * and the further ahead it reads the more it is planning the market rather than trading it.
 */
export const AUTO_MIN_HOLD_SEC = 5;
export const AUTO_MAX_HOLD_SEC = 900;
export const AUTO_MAX_POSITIONS_PER_MOVE = 20;
export const AUTO_MAX_GAP_SEC = 600;

export interface AutoTradeSettings {
  enabled: boolean;
  minHoldSec: number;
  maxHoldSec: number;
  gapSec: number;
  positionsPerMove: number;
  volume: number;
}

/**
 * The automated-trading settings, made safe to act on.
 *
 * Every field is clamped here rather than trusted from the config, because this is the one
 * place between a text box and code that opens real positions. The settings screen limits what
 * can be *typed*, but a config also arrives from `localStorage` and the server mirror, and a
 * `maxHoldSec` of `NaN` reaching the engine is an infinite loop holding a live trade.
 *
 * `min` and `max` are sorted rather than rejected. Someone raising the minimum past the maximum
 * has expressed a range with the ends the wrong way round, which is an obvious thing to do
 * halfway through editing two boxes — treating it as an error would refuse to trade for a
 * reason the screen does not show.
 */
export function autoTradeSettings(config: AccountConfig): AutoTradeSettings {
  const clamp = (value: number, low: number, high: number, fallback: number) =>
    Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;

  const a = clamp(config.autoMinHoldSec, AUTO_MIN_HOLD_SEC, AUTO_MAX_HOLD_SEC, 20);
  const b = clamp(config.autoMaxHoldSec, AUTO_MIN_HOLD_SEC, AUTO_MAX_HOLD_SEC, 180);

  return {
    enabled: config.autoTrade === true,
    minHoldSec: Math.min(a, b),
    maxHoldSec: Math.max(a, b),
    gapSec: clamp(config.autoGapSec, 0, AUTO_MAX_GAP_SEC, 45),
    positionsPerMove: Math.round(clamp(config.autoPositionsPerMove, 1, AUTO_MAX_POSITIONS_PER_MOVE, 1)),
    volume: clamp(config.autoVolume, 0.01, 1000, 0.01),
  };
}

/** The same, for components. */
export function useAutoTradeSettings(): AutoTradeSettings {
  return autoTradeSettings(useAccount());
}

/**
 * The comment on every open position. Empty means there is none.
 *
 * Clamped on the way out as well as on the way in. The input caps what can be typed, but a
 * config also arrives from `localStorage` and from the server mirror — written, possibly, by a
 * build that had no cap or a longer one — and the display is the last place that can still be
 * sure.
 */
export function useTradeComment(): string {
  return normalizeTradeComment(useAccount().tradeComment);
}

/** A function that names any balance operation, for components rendering a ledger. */
export function useBalanceOpName(): (amount: number) => string {
  const config = useAccount();
  return (amount: number) => balanceOpName(config, amount);
}

/* ------------------------------------------------------------------ */
/*  Storage scope                                                      */
/* ------------------------------------------------------------------ */
/**
 * The name everything this account owns is filed under.
 *
 * `'local'` when no number is set — a real slot on this device, not a shared one. Falling back
 * to a fixed default would put two numberless devices back in the same drawer, which is the
 * problem all of this exists to fix.
 */
export function accountScope(): string {
  return normalizeAccountKey(accountStore.getSnapshot().accountNumber) ?? 'local';
}

/** The same value, for components. Re-renders when the number changes, which is the point. */
export function useAccountScope(): string {
  return normalizeAccountKey(useAccount().accountNumber) ?? 'local';
}
