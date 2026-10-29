import { findInstrument } from '@/lib/instruments';
import type { QuoteState } from '@/lib/market/store';
import { MAX_VOLUME, MIN_VOLUME, VOLUME_STEP, type Book, type Position, type Side } from './types';

/* ------------------------------------------------------------------ */
/*  Account terms                                                      */
/* ------------------------------------------------------------------ */
/**
 * Leverage, and what it does and does not gate.
 *
 * `500` is a standard retail leverage, and a finite number here is what makes the margin
 * apparatus a live thing rather than a set of rows that can only print zero. Required margin,
 * free margin, margin level, margin call and stop out all fall out of this one constant.
 *
 * It used to be `Infinity` — a "full-margin" account where a position tied up no collateral.
 * That is a coherent account to write, and every formula below divides by leverage so it needed
 * no special-casing, but it costs the screen the one figure a trader reads first: with zero
 * margin, margin level is a division by nothing, so the Trade screen had nothing to print in
 * that row and free margin was only ever a second copy of equity.
 *
 * What this does *not* gate is order entry. MT5 refuses a trade whose margin exceeds free
 * margin; this account deliberately does not — see `placeMarketOrder` in the engine, where the
 * only entry check is solvency. Leverage being finite changes what the numbers say, not what
 * the account is allowed to do.
 *
 * `isUnlimitedLeverage` stays because the full-margin mode stays reachable: set this back to
 * `Infinity` and every margin figure returns to zero without anything else changing.
 */
export const ACCOUNT_LEVERAGE: number = 500;

/** True while nothing can tie up collateral, which is what makes free margin === equity. */
export function isUnlimitedLeverage(): boolean {
  return !Number.isFinite(ACCOUNT_LEVERAGE) || ACCOUNT_LEVERAGE <= 0;
}

/**
 * MT5's two protection levels, in percent of margin.
 *
 * Live now that leverage is finite. At 1:500 an account has to lose almost everything before
 * equity falls to half its margin, so in practice the stop out fires moments before the equity
 * floor would have — which is exactly the ordering a real terminal has.
 */
export const MARGIN_CALL_LEVEL = 100;
export const STOP_OUT_LEVEL = 50;

/**
 * The level at which an account is finished regardless of its margin level.
 *
 * Equity reaching zero *is* running out of money: the balance plus every open trade marked to
 * market is what the account is worth, and at zero there is nothing left to lose with. It is
 * the only floor a full-margin account has, and it remains the backstop under the stop out for
 * a leveraged one — a gap through both levels on one tick lands here. The engine liquidates,
 * and the balance is squared at zero rather than left owing — see `enforceMargin`.
 */
export const EQUITY_FLOOR = 0;

/* ------------------------------------------------------------------ */
/*  Currency                                                           */
/* ------------------------------------------------------------------ */
/** The deposit currency. Every figure this module returns is in it. */
export const DEPOSIT_CURRENCY = 'USD';

/**
 * Base and quote currency codes, read off the symbol rather than the instrument record.
 *
 * The table's `base`/`quote` fields hold descriptions ("Euro", "Gold") for the symbol
 * detail screen, not codes — so they cannot be used to price a conversion. The canonical name
 * is six characters of two ISO codes for everything tradeable here, which is the same rule
 * MT5 falls back on when a broker sends no currency fields.
 */
export function currenciesOf(symbol: string): { base: string; quote: string } {
  const name = String(symbol ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (name.length < 6) return { base: name, quote: DEPOSIT_CURRENCY };
  return { base: name.slice(0, 3), quote: name.slice(3, 6) };
}

/**
 * What one unit of `currency` is worth in the deposit currency.
 *
 * Looks for the direct pair first and the inverted one second, which between them cover every
 * currency any instrument here is quoted in. Returns `null` when neither leg is on the board —
 * the caller then leaves the figure unconverted rather than multiplying by a guess, because a
 * P/L that is honestly in the wrong currency is recoverable and one silently scaled by a stale
 * rate is not.
 */
export function usdRate(currency: string, quotes: Record<string, QuoteState>): number | null {
  if (!currency || currency === DEPOSIT_CURRENCY) return 1;

  const direct = quotes[`${currency}${DEPOSIT_CURRENCY}`];
  if (direct && direct.bid > 0 && direct.ask > 0) return (direct.bid + direct.ask) / 2;

  const inverted = quotes[`${DEPOSIT_CURRENCY}${currency}`];
  if (inverted && inverted.bid > 0 && inverted.ask > 0) {
    const mid = (inverted.bid + inverted.ask) / 2;
    if (mid > 0) return 1 / mid;
  }

  return null;
}

/**
 * The USD pairs `usdRate` needs to value and margin a position in `symbol` — e.g. GBPJPY needs
 * GBPUSD (margin, base leg) and USDJPY (profit, quote leg). Only pairs this app knows are
 * returned; whichever leg the store actually publishes is the one `usdRate` will find.
 */
export function conversionSymbols(symbol: string): string[] {
  const { base, quote } = currenciesOf(symbol);
  const out: string[] = [];
  for (const currency of [base, quote]) {
    if (!currency || currency === DEPOSIT_CURRENCY) continue;
    for (const pair of [`${currency}${DEPOSIT_CURRENCY}`, `${DEPOSIT_CURRENCY}${currency}`]) {
      if (pair !== symbol && findInstrument(pair)) out.push(pair);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Position valuation                                                 */
/* ------------------------------------------------------------------ */
/**
 * Everything a broker's terminal shows about money, computed from the tick stream alone.
 *
 * Deliberately provider-agnostic: it prices off whatever `QuoteState` the market store is
 * producing, so a position marks to market from whatever moment the session is playing. That
 * is what makes the numbers trustworthy at any point in the window.
 *
 * Figures are reported in the deposit currency. Profit is earned in the *quote* currency and
 * converted through whichever USD leg is on the board — GBPJPY makes yen, and yen becomes
 * dollars at USDJPY. Every instrument in the curated list except the crosses is already
 * USD-quoted, so the conversion is a no-op for most of them; where it is not, the figure used
 * to be tens of percent wrong and silently so.
 */

/**
 * Units per lot.
 *
 * Taken from the broker's own symbol spec when the catalogue has arrived, because this is the
 * number every P/L and margin figure multiplies through — guessing it from the instrument's
 * group is how a gold trade ends up sized like a forex one. Forex 100k, gold 100oz, crypto
 * 1:1 are the fallbacks, and they are only reached before the first catalogue or offline.
 */
export function contractSize(symbol: string): number {
  const instrument = findInstrument(symbol);
  if (instrument?.contractSize && instrument.contractSize > 0) return instrument.contractSize;

  if (instrument?.group === 'Crypto') return 1;
  if (instrument?.group === 'Metals') return 100;
  return 100_000;
}

/**
 * Which of MT5's margin formulas an instrument uses.
 *
 * The two differ in what they measure and in the currency the answer lands in, which is the
 * part that used to be wrong here. Forex margin is a share of the *base*-currency notional and
 * does not depend on the price at all; a CFD's is a share of the contract's market value and
 * therefore does. Applying the CFD rule to forex is how a USDJPY lot came out asking a hundred
 * and fifty times the margin it should.
 */
function marginMode(symbol: string): 'forex' | 'cfd' {
  const group = findInstrument(symbol)?.group;
  return group === 'Forex Majors' || group === 'Forex Crosses' ? 'forex' : 'cfd';
}

/**
 * Mark-to-market profit, in the deposit currency.
 *
 * A buy is opened at the ask and closed at the bid (and the reverse for a sell), which is why
 * a fresh position always starts slightly negative — that gap is the spread, and it is a real
 * cost, not a rounding artefact.
 *
 * `quotes` is optional and only carries the conversion legs. Without it the figure stays in
 * the quote currency, which is what every USD-quoted instrument wants anyway.
 */
export function positionProfit(
  position: Position,
  quote: QuoteState | undefined,
  quotes?: Record<string, QuoteState>
): number | null {
  if (!quote) return null;

  const closePrice = closePriceFor(position, quote);
  if (closePrice === null) return null;

  const move =
    position.type === 'buy'
      ? closePrice - position.openPrice
      : position.openPrice - closePrice;

  return convertToDeposit(
    move * position.volume * contractSize(position.symbol),
    position.symbol,
    quotes
  );
}

/**
 * Convert an amount earned in a symbol's quote currency into the deposit currency.
 *
 * Exported because the engine has to do the same conversion when it *realises* a profit, and
 * a realised figure that disagreed with the floating one it replaced would be a hole in the
 * balance the size of the cross rate.
 */
export function convertToDeposit(
  amount: number,
  symbol: string,
  quotes: Record<string, QuoteState> | undefined
): number {
  if (!quotes) return amount;

  const { quote } = currenciesOf(symbol);
  if (quote === DEPOSIT_CURRENCY) return amount;

  const rate = usdRate(quote, quotes);
  return rate === null ? amount : amount * rate;
}

/** Profit including the carrying costs the broker has already charged. */
export function positionNet(
  position: Position,
  quote: QuoteState | undefined,
  quotes?: Record<string, QuoteState>
): number | null {
  const gross = positionProfit(position, quote, quotes);
  if (gross === null) return null;
  return gross + position.swap + position.commission;
}

/**
 * What this position would be worth if it closed at `price`.
 *
 * Answers the question a stop or a target is really asking: not "where is this level" but
 * "what does it cost me". Net rather than gross, and for the same reason `positionNet` is —
 * swap and commission are already charged, so a stop quoted without them understates the loss
 * by exactly the amount the broker has already taken.
 *
 * No spread adjustment: the level *is* the close price. A stop fills at the stop.
 */
export function profitAtPrice(
  position: Position,
  price: number,
  quotes?: Record<string, QuoteState>
): number {
  const move =
    position.type === 'buy' ? price - position.openPrice : position.openPrice - price;

  const gross = convertToDeposit(
    move * position.volume * contractSize(position.symbol),
    position.symbol,
    quotes
  );

  return gross + position.swap + position.commission;
}

/** The price a position would close at right now: bid for a long, ask for a short. */
export function closePriceFor(position: Position, quote: QuoteState | undefined): number | null {
  if (!quote) return null;
  return position.type === 'buy' ? quote.bid : quote.ask;
}

/**
 * Margin locked up by one position, to MT5's rules.
 *
 * Three things here that the previous version had wrong, and each of them mattered:
 *
 *   · **Forex does not use the price.** Required margin on a currency pair is
 *     `lots × contract size ÷ leverage` in the *base* currency, converted to the deposit
 *     currency. Multiplying by the quote price as well — which is what a CFD needs and forex
 *     does not — overstated every JPY and CHF pair by the price itself.
 *   · **CFDs and metals do use it**, as `lots × contract size × price ÷ leverage` in the quote
 *     currency. That branch was right and is kept.
 *   · **The price is the open price, not the current bid.** MT5 fixes a position's margin when
 *     it opens and never revalues it. Marking it to market meant the number moved underneath
 *     the account all day, and — worse — margin *fell* as a long lost money, so the one figure
 *     that is supposed to tighten as an account gets into trouble was loosening instead.
 *
 * Returns zero on a full-margin account, which is the whole of what unlimited leverage means.
 */
export function positionMargin(
  position: Position,
  quotes?: Record<string, QuoteState>
): number {
  if (isUnlimitedLeverage()) return 0;

  const size = position.volume * contractSize(position.symbol);
  const { base, quote } = currenciesOf(position.symbol);

  if (marginMode(position.symbol) === 'forex') {
    const inBase = size / ACCOUNT_LEVERAGE;
    const rate = quotes ? usdRate(base, quotes) : null;
    if (rate !== null) return inBase * rate;

    // No conversion leg on the board. Three cases, and only two of them can be converted:
    //   · base is already the deposit currency (USDJPY) — the notional is in dollars already
    //   · the pair is quoted in it (GBPUSD) — its own price *is* the rate, so this is exact
    //   · a cross (GBPJPY) — nothing here prices GBP in dollars, so the figure stays in the
    //     base currency rather than being multiplied by the one number to hand. That number
    //     is a GBP/JPY rate: using it would render a GBP notional in yen and label it USD,
    //     which on a 0.10 lot is 3,968 instead of 25. Unconverted is wrong by the cross rate;
    //     converted by the wrong leg is wrong by a factor of 157. This is the same rule
    //     `usdRate` and `convertToDeposit` already follow for profit.
    if (base === DEPOSIT_CURRENCY) return inBase;
    return quote === DEPOSIT_CURRENCY ? inBase * position.openPrice : inBase;
  }

  const inQuote = (size * position.openPrice) / ACCOUNT_LEVERAGE;
  if (quote === DEPOSIT_CURRENCY || !quotes) return inQuote;

  const rate = usdRate(quote, quotes);
  return rate === null ? inQuote : inQuote * rate;
}

export interface AccountSummary {
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  /**
   * Equity as a percentage of margin.
   *
   * `null` — not zero — when no margin is tied up, which with a finite leverage means only
   * when the book is empty. Dividing by nothing has no answer, and `0` would be a lie in the
   * one direction that matters: zero reads as the worst margin level there is when what it
   * means is that nothing is at risk. Callers render nothing for `null`, which is what MT5's
   * own Trade screen does on a flat account.
   */
  marginLevel: number | null;
  /** Floating P/L across every open position, including swap already charged. */
  openProfit: number;
  /** True once the account has nothing left to trade with. See `EQUITY_FLOOR`. */
  blown: boolean;
  /** True while the margin level sits under MT5's margin-call level. Inert at zero margin. */
  marginCall: boolean;
}

export function accountSummary(
  balance: number,
  positions: Position[],
  quotes: Record<string, QuoteState>
): AccountSummary {
  let openProfit = 0;
  let margin = 0;

  for (const position of positions) {
    const quote = quotes[position.symbol];
    openProfit += positionNet(position, quote, quotes) ?? 0;
    margin += positionMargin(position, quotes);
  }

  const equity = balance + openProfit;
  const marginLevel = margin > 0 ? (equity / margin) * 100 : null;

  return {
    balance,
    equity,
    margin,
    freeMargin: equity - margin,
    marginLevel,
    openProfit,
    blown: positions.length > 0 && equity <= EQUITY_FLOOR,
    marginCall: marginLevel !== null && marginLevel <= MARGIN_CALL_LEVEL,
  };
}

/**
 * What the account is required to do about its own state right now.
 *
 * Two distinct failures, deliberately not collapsed into one. A stop out is survivable: MT5
 * closes the worst position, frees its margin, and the account often recovers on the same tick.
 * Being blown is not — no single closure brings equity back above zero, because closing a
 * position realises exactly the loss it was already floating. The only correct response is to
 * close everything and stop.
 */
export type MarginAction = 'none' | 'stop-out' | 'blown';

export function marginAction(summary: AccountSummary): MarginAction {
  if (summary.blown) return 'blown';
  if (summary.marginLevel !== null && summary.marginLevel <= STOP_OUT_LEVEL) return 'stop-out';
  return 'none';
}

/** Equity is what a margin check must be made against — balance alone ignores open losses. */
export function freeMarginOf(book: Book, quotes: Record<string, QuoteState>): number {
  return accountSummary(book.balance, book.positions, quotes).freeMargin;
}

/* ------------------------------------------------------------------ */
/*  Volume                                                             */
/* ------------------------------------------------------------------ */
/**
 * How much of an instrument one lot is, and what sizes of it may be traded.
 *
 * A lot is not a unit. It is 100,000 units of base currency on a major, 100 ounces of gold,
 * one bitcoin, and one XRP — so "0.01 lots" is about a thousand dollars of EURUSD, fourteen
 * thousand of gold, and a rounding error of XRP. Brokers deal with that by giving every symbol
 * its own minimum, maximum and step, and those numbers are how a lot stops being an abstraction
 * and starts describing a real position.
 *
 * All three already lived on the catalogue entry — `volumeMin`, `volumeMax`, `volumeStep`, sent
 * by the broker and defaulted in the table — and nothing read them. Order entry validated
 * against one global pair of bounds and snapped everything to hundredths, which meant:
 *
 *   · XRP, whose minimum is a whole lot, could be traded in hundredths of one
 *   · Litecoin, which steps in tenths, could be sized to any hundredth
 *   · a major, capped at 200 lots, could be opened at 1,000 — twenty million euro of exposure
 *   · XRP, allowed 10,000 lots, was refused above 1,000
 *
 * Each of those is the catalogue being right and the engine ignoring it.
 */
export interface VolumeSpec {
  min: number;
  max: number;
  step: number;
  /** Decimal places implied by the step — 2 for 0.01, 1 for 0.1, 0 for a whole lot. */
  digits: number;
}

/**
 * Decimals needed to write `step` exactly.
 *
 * Derived rather than stored because it is not an independent fact: a step of 0.1 displayed to
 * two places puts a digit on screen the stepper can never change, and one displayed to none
 * rounds the value away entirely. Capped at three, which is finer than any broker steps.
 */
function stepDigits(step: number): number {
  for (let digits = 0; digits < 3; digits += 1) {
    const factor = 10 ** digits;
    if (Math.abs(step * factor - Math.round(step * factor)) < 1e-9) return digits;
  }
  return 3;
}

/**
 * The tradeable sizes for one instrument.
 *
 * Falls back to the global constants only for a symbol that is in neither the table nor the
 * broker's catalogue. Each field is guarded independently, because a broker that sends a zero
 * for one of them — which they do, for symbols they are not currently offering — should not
 * take the other two down with it.
 */
export function volumeSpec(symbol: string): VolumeSpec {
  const instrument = findInstrument(symbol);

  const step = instrument?.volumeStep && instrument.volumeStep > 0 ? instrument.volumeStep : VOLUME_STEP;
  const min = instrument?.volumeMin && instrument.volumeMin > 0 ? instrument.volumeMin : MIN_VOLUME;
  const max = instrument?.volumeMax && instrument.volumeMax > 0 ? instrument.volumeMax : MAX_VOLUME;

  return { min, max: Math.max(min, max), step, digits: stepDigits(step) };
}

/**
 * Snap a volume onto the instrument's own step and clamp it into its own range.
 *
 * Counted in whole steps rather than divided by the step at the end: `x / 0.1` carries float
 * error that a later rounding has to undo, and the two roundings can disagree by a step — which
 * on XRP, whose step is a whole lot, is a hundred percent sizing error rather than a cosmetic
 * one. One conversion, one rounding, then the value is rebuilt from the step it landed on.
 *
 * The minimum is what an unreadable value becomes, because the smallest tradeable size is the
 * only safe thing to assume when the intended one cannot be known.
 */
export function normalizeVolume(volume: number, symbol?: string): number {
  const { min, max, step, digits } = volumeSpec(symbol ?? '');
  if (!Number.isFinite(volume)) return min;

  const steps = Math.round(volume / step);
  const snapped = Number((steps * step).toFixed(digits));

  return Math.min(max, Math.max(min, snapped));
}

/** The volume a fresh ticket opens at: the smallest this instrument can be traded in. */
export function defaultVolume(symbol: string): number {
  return volumeSpec(symbol).min;
}

/** Lots, written to the precision the instrument's own step justifies. */
export function formatVolume(volume: number, symbol: string): string {
  return volume.toFixed(volumeSpec(symbol).digits);
}

/* ------------------------------------------------------------------ */
/*  Swap (overnight financing)                                         */
/* ------------------------------------------------------------------ */
/**
 * Charged per lot when a position is held through the 21:00 UTC rollover, and tripled on
 * Wednesday night to cover the weekend's value date — the convention every MT5 broker uses.
 *
 * The rates are representative retail numbers rather than any specific broker's sheet. They
 * exist so a position held for a week costs something to carry, which is the behaviour that
 * makes a multi-day backtest honest.
 */
const SWAP_PER_LOT: Record<string, { long: number; short: number }> = {
  'Forex Majors': { long: -7, short: 2 },
  'Forex Crosses': { long: -9, short: 1 },
  Metals: { long: -12, short: 4 },
  Crypto: { long: -20, short: -20 },
};

const ROLLOVER_HOUR_UTC = 21;

export function swapPerLot(symbol: string, side: Side): number {
  const group = findInstrument(symbol)?.group ?? 'Forex Majors';
  const rates = SWAP_PER_LOT[group] ?? SWAP_PER_LOT['Forex Majors'];
  return side === 'buy' ? rates.long : rates.short;
}

/** Unix ms of the most recent 21:00 UTC rollover at or before `atMs`. */
function lastRollover(atMs: number): number {
  const d = new Date(atMs);
  const todays = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    ROLLOVER_HOUR_UTC
  );
  return todays <= atMs ? todays : todays - 86_400_000;
}

/**
 * Swap owed for every rollover crossed between `from` and `to`.
 *
 * Walks the boundaries rather than dividing elapsed time, because Wednesday counts triple and
 * the weekend counts not at all. Returns the amount plus the timestamp of the last rollover
 * applied, so the caller can record it and never charge the same night twice — which is what
 * makes this safe across an app that was closed for a week.
 */
export function accrueSwap(
  position: Position,
  toMs: number
): { swap: number; lastSwapAt: number } {
  const from = position.lastSwapAt || position.openTime;
  let boundary = lastRollover(from);
  let charged = 0;
  let applied = position.lastSwapAt;

  // Start at the first rollover strictly after the last one already billed.
  boundary += 86_400_000;

  // Bounded so a corrupt timestamp can't spin here; 400 nights is over a year.
  for (let guard = 0; guard < 400 && boundary <= toMs; guard++) {
    const day = new Date(boundary).getUTCDay();

    // Friday 21:00 and Saturday 21:00 fall inside the closed weekend — nothing is financed.
    if (day !== 5 && day !== 6) {
      const multiplier = day === 3 ? 3 : 1; // Wednesday night carries the weekend
      charged += swapPerLot(position.symbol, position.type) * position.volume * multiplier;
    }

    applied = boundary;
    boundary += 86_400_000;
  }

  return { swap: Math.round(charged * 100) / 100, lastSwapAt: applied };
}
