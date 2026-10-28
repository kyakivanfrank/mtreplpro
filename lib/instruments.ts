import { cachedSpec } from '@/lib/market/meta';

/* ------------------------------------------------------------------ */
/*  The tradeable list                                                 */
/* ------------------------------------------------------------------ */
/**
 * What the app knows about an instrument, and where it comes from.
 *
 * Two sources, in priority order. The broker's own spec — digits, point size, contract size,
 * real spread, volume steps — arrives over the feed as its symbol catalogue and is cached per
 * symbol in the `meta` store. That is the truth: it is this account, at this broker, today.
 *
 * The table below is the fallback, used before the first catalogue arrives and on a device
 * that has never connected. It carries the names and groupings a broker does not send in a
 * useful form, plus conservative defaults for everything else.
 *
 * Names are canonical throughout: "EURUSD", "XAUUSD", "BTCUSD" — the same strings the bridge
 * speaks. The app previously used a slashed form ("EUR/USD") inherited from Twelve Data's API,
 * which meant every lookup against a feed symbol silently missed: gold rendered at five
 * decimals, bitcoin was priced with a forex contract size, and the order ticket had no
 * instrument at all. `normalizeSymbol` accepts the old form so nothing has to translate.
 */

export interface Instrument {
  /** Canonical name, e.g. "EURUSD". The one identity used for lookup everywhere. */
  symbol: string;
  /** What to show the user. Same as `symbol` — MT5 displays the bare name. */
  display: string;
  /**
   * What this broker calls it, e.g. "EURUSDm". Only known once the catalogue has arrived.
   *
   * Informational only — kept for support and debugging. Displayed names come from the
   * account type chosen in settings (`brokerSymbol`), never from this field.
   */
  broker?: string;
  base: string;
  quote: string;
  group: InstrumentGroup;
  /** Price precision. 5 for most forex, 3 for JPY pairs, 2 for gold and crypto. */
  digits: number;
  /** Smallest price increment. 10^-digits unless the broker says otherwise. */
  point: number;
  /** Typical spread in points. Replaced by the broker's real figure once known. */
  spread: number;
  /** Units per lot: 100,000 forex, 100 gold, 1 crypto — until the broker says otherwise. */
  contractSize: number;
  volumeMin: number;
  volumeMax: number;
  volumeStep: number;
  /** True when these numbers came from the broker rather than from the table below. */
  fromBroker: boolean;
}

export const GROUPS = ['Forex Majors', 'Forex Crosses', 'Metals', 'Crypto'] as const;
export type InstrumentGroup = (typeof GROUPS)[number];

const M: InstrumentGroup = 'Forex Majors';
const C: InstrumentGroup = 'Forex Crosses';

/**
 * Reduce any spelling to the canonical one.
 *
 * Accepts "EUR/USD" and "eur-usd" as well as "EURUSD", so a stored value, a URL, or a hand-typed
 * search all resolve to the same instrument.
 */
export function normalizeSymbol(name: string): string {
  return String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function fx(pair: string, base: string, quote: string, group: InstrumentGroup, spread: number): Instrument {
  const digits = pair.endsWith('JPY') ? 3 : 5;
  return {
    symbol: pair,
    display: pair,
    base,
    quote,
    group,
    digits,
    point: 10 ** -digits,
    spread,
    contractSize: 100_000,
    volumeMin: 0.01,
    volumeMax: 200,
    volumeStep: 0.01,
    fromBroker: false,
  };
}

function other(
  symbol: string,
  base: string,
  quote: string,
  group: InstrumentGroup,
  digits: number,
  spread: number,
  contractSize: number,
  volumeMin: number,
  volumeMax: number,
  volumeStep: number
): Instrument {
  return {
    symbol,
    display: symbol,
    base,
    quote,
    group,
    digits,
    point: 10 ** -digits,
    spread,
    contractSize,
    volumeMin,
    volumeMax,
    volumeStep,
    fromBroker: false,
  };
}

export const INSTRUMENTS: Instrument[] = [
  /* --- the seven majors --- */
  fx('EURUSD', 'Euro', 'US Dollar', M, 2),
  fx('GBPUSD', 'British Pound', 'US Dollar', M, 3),
  fx('USDJPY', 'US Dollar', 'Japanese Yen', M, 3),
  fx('USDCHF', 'US Dollar', 'Swiss Franc', M, 3),
  fx('AUDUSD', 'Australian Dollar', 'US Dollar', M, 3),
  fx('USDCAD', 'US Dollar', 'Canadian Dollar', M, 4),
  fx('NZDUSD', 'New Zealand Dollar', 'US Dollar', M, 4),

  /* --- crosses --- */
  fx('EURGBP', 'Euro', 'British Pound', C, 5),
  fx('EURJPY', 'Euro', 'Japanese Yen', C, 5),
  fx('EURCHF', 'Euro', 'Swiss Franc', C, 5),
  fx('EURAUD', 'Euro', 'Australian Dollar', C, 8),
  fx('EURCAD', 'Euro', 'Canadian Dollar', C, 8),
  fx('EURNZD', 'Euro', 'New Zealand Dollar', C, 12),
  fx('GBPJPY', 'British Pound', 'Japanese Yen', C, 6),
  fx('GBPCHF', 'British Pound', 'Swiss Franc', C, 9),
  fx('GBPAUD', 'British Pound', 'Australian Dollar', C, 12),
  fx('GBPCAD', 'British Pound', 'Canadian Dollar', C, 12),
  fx('GBPNZD', 'British Pound', 'New Zealand Dollar', C, 15),
  fx('AUDJPY', 'Australian Dollar', 'Japanese Yen', C, 5),
  fx('AUDCAD', 'Australian Dollar', 'Canadian Dollar', C, 7),
  fx('AUDCHF', 'Australian Dollar', 'Swiss Franc', C, 7),
  fx('AUDNZD', 'Australian Dollar', 'New Zealand Dollar', C, 10),
  fx('NZDJPY', 'New Zealand Dollar', 'Japanese Yen', C, 6),
  fx('NZDCAD', 'New Zealand Dollar', 'Canadian Dollar', C, 9),
  fx('NZDCHF', 'New Zealand Dollar', 'Swiss Franc', C, 9),
  fx('CADJPY', 'Canadian Dollar', 'Japanese Yen', C, 6),
  fx('CADCHF', 'Canadian Dollar', 'Swiss Franc', C, 8),
  fx('CHFJPY', 'Swiss Franc', 'Japanese Yen', C, 7),

  /* --- metals: 100 oz per lot --- */
  other('XAUUSD', 'Gold', 'US Dollar', 'Metals', 2, 25, 100, 0.01, 50, 0.01),
  other('XAGUSD', 'Silver Spot', 'US Dollar', 'Metals', 3, 30, 5_000, 0.01, 50, 0.01),

  /* --- crypto: 1 coin per lot, trades every day of the week --- */
  other('BTCUSD', 'Bitcoin', 'US Dollar', 'Crypto', 2, 2_000, 1, 0.01, 10, 0.01),
  other('ETHUSD', 'Ethereum', 'US Dollar', 'Crypto', 2, 200, 1, 0.01, 100, 0.01),
  other('LTCUSD', 'Litecoin', 'US Dollar', 'Crypto', 2, 50, 1, 0.1, 500, 0.1),
  other('XRPUSD', 'Ripple', 'US Dollar', 'Crypto', 5, 20, 1, 1, 10_000, 1),
];

const BY_SYMBOL = new Map(INSTRUMENTS.map((i) => [i.symbol, i]));

/**
 * Resolve an instrument, preferring what the broker said.
 *
 * The returned object is the table entry with any known broker figures laid over it, so a
 * caller never has to ask which source it got. `fromBroker` reports which happened, for the
 * few places that should say so.
 *
 * Returns `undefined` only for a symbol that is in neither the table nor the catalogue.
 */
export function findInstrument(name: string): Instrument | undefined {
  const symbol = normalizeSymbol(name);
  if (!symbol) return undefined;

  const base = BY_SYMBOL.get(symbol);
  const spec = cachedSpec(symbol);

  if (!spec) return base;

  // The broker knows a symbol the table does not. Take its word for everything and infer the
  // grouping, so a newly offered instrument works without a code change.
  if (!base) {
    return {
      symbol,
      display: symbol,
      broker: spec.broker,
      base: spec.description || symbol,
      quote: '',
      group: (GROUPS as readonly string[]).includes(spec.group)
        ? (spec.group as InstrumentGroup)
        : 'Forex Crosses',
      digits: spec.digits,
      point: spec.point,
      spread: spec.spread,
      contractSize: spec.contractSize,
      volumeMin: spec.volumeMin,
      volumeMax: spec.volumeMax,
      volumeStep: spec.volumeStep,
      fromBroker: true,
    };
  }

  return {
    ...base,
    broker: spec.broker,
    digits: spec.digits,
    point: spec.point,
    // A broker reporting zero spread means "floating, currently unknown", not "free" — keep
    // the table's estimate rather than showing a spread of nothing.
    spread: spec.spread > 0 ? spec.spread : base.spread,
    contractSize: spec.contractSize,
    volumeMin: spec.volumeMin,
    volumeMax: spec.volumeMax,
    volumeStep: spec.volumeStep,
    fromBroker: true,
  };
}

/** Every instrument the app can offer: the table, plus anything the broker added. */
export function allInstruments(): Instrument[] {
  const merged = new Map<string, Instrument>();
  for (const item of INSTRUMENTS) {
    merged.set(item.symbol, findInstrument(item.symbol) ?? item);
  }
  const order: Record<string, number> = {
    'Forex Majors': 0,
    'Forex Crosses': 1,
    Metals: 2,
    Crypto: 3,
  };
  return [...merged.values()].sort(
    (a, b) => (order[a.group] ?? 9) - (order[b.group] ?? 9) || a.symbol.localeCompare(b.symbol)
  );
}
