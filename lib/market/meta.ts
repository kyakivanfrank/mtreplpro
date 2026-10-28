'use client';

import { dbGet, dbKeys, dbSet } from '@/lib/db';

/* ------------------------------------------------------------------ */
/*  Per-symbol sync state and instrument spec                          */
/* ------------------------------------------------------------------ */
/**
 * What the device knows *about* a symbol, as opposed to its bars.
 *
 * The spec is the substance of it: digits, point size, contract size and the real spread used
 * to be hard-coded constants in lib/instruments.ts because the REST providers carried no
 * bid/ask at all. The bridge sends the broker's actual numbers, so they are stored per symbol
 * and the constants became a fallback for a device that has never connected.
 *
 * There used to be a sync watermark here as well, so a reconnect could ask for the tail rather
 * than a fresh window. The minute archive tracks its own range now, and coarse bars are no
 * longer fetched at all, so it went with them.
 */

export interface SymbolMeta {
  symbol: string;
  /** When a chart last opened this symbol. Unix ms. */
  viewedAt: number;
  /** Broker spec, absent until the device has seen the feed's catalogue. */
  spec?: InstrumentSpec;
}

export interface InstrumentSpec {
  /** What the broker calls it, e.g. "XAUUSDm". Kept for support and debugging. */
  broker: string;
  description: string;
  group: string;
  digits: number;
  point: number;
  contractSize: number;
  /** Real spread in points, from the account. Not a synthesized constant. */
  spread: number;
  volumeMin: number;
  volumeMax: number;
  volumeStep: number;
}

const memory = new Map<string, SymbolMeta>();

function blank(symbol: string): SymbolMeta {
  return { symbol, viewedAt: 0 };
}

export async function loadMeta(symbol: string): Promise<SymbolMeta> {
  const cached = memory.get(symbol);
  if (cached) return cached;

  const stored = await dbGet<SymbolMeta>('meta', symbol);
  const meta = stored ?? blank(symbol);
  memory.set(symbol, meta);
  return meta;
}

export async function saveMeta(meta: SymbolMeta): Promise<void> {
  memory.set(meta.symbol, meta);
  await dbSet('meta', meta.symbol, meta);
}

/** Mark a symbol as opened. Drives eviction order, so it is the one write on every chart open. */
export async function recordView(symbol: string): Promise<void> {
  const meta = await loadMeta(symbol);
  await saveMeta({ ...meta, viewedAt: Date.now() });
}

/** Store the broker's spec for a symbol, from the feed's catalogue. */
export async function recordSpec(symbol: string, spec: InstrumentSpec): Promise<void> {
  const meta = await loadMeta(symbol);
  await saveMeta({ ...meta, spec });
}

/** Read a spec without awaiting the database, for code paths that render synchronously. */
export function cachedSpec(symbol: string): InstrumentSpec | undefined {
  return memory.get(symbol)?.spec;
}

/** Warm the in-memory map so `cachedSpec` is useful on the first render after launch. */
export async function primeMetaCache(): Promise<void> {
  const symbols = await dbKeys('meta');
  await Promise.all(symbols.map((symbol) => loadMeta(symbol)));
}
