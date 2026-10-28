'use client';

import { recordSpec, type InstrumentSpec } from './meta';
import {
  applyCsv,
  heldDays,
  loadArchive,
  needsFullDownload,
  setPublishedCandles,
} from './archive';

/* ------------------------------------------------------------------ */
/*  The downloader                                                     */
/* ------------------------------------------------------------------ */
/**
 * Keeps each symbol's minute archive level with the published store.
 *
 * This has been three things. It streamed ticks over a WebSocket, which is what made minute
 * trading unusable — a chart being read and traded was rewritten under the user by every
 * re-sync. Then it fetched history over HTTP from a bridge on the VPS, which worked but
 * needed that machine to be reachable from the internet: a firewall rule, a public address
 * that changed, and eventually a heartbeat so the app could keep track of where it had gone.
 *
 * Now nothing reaches the VPS at all. The terminal publishes candles *outbound* into a
 * database every thirty minutes and the app reads them from there, so the machine that runs
 * live trading has no inbound port. That deleted the firewall rule, the address problem, the
 * self-registration heartbeat, the mixed-content rule and the TLS requirement in one go.
 *
 * ── The manifest is the whole design ─────────────────────────────────
 *
 * The publisher records how many candles it holds for each symbol on each day, and
 * `/api/mt5/meta` carries that record. The archive counts its own candles exactly the same
 * way. So neither side ever has to work out where it stopped: both wrote it down, and the
 * difference between the two lists *is* the download.
 *
 * A day whose count matches is not requested. A day whose count moved, or that this device
 * has never seen, is. That one comparison replaced three separate mechanisms — a fixed
 * "fetch the last two days" refresh, a rolling floor derived from the newest bar, and a
 * heuristic that guessed whether a hole had opened up and re-pulled the entire window if it
 * thought so. All three were approximations of the question the manifest answers exactly.
 *
 * Two things fall out of it. A closed market costs a device *nothing* — over a weekend
 * nothing published changes, so nothing is asked for, where the old refresh pulled two
 * identical days every half hour. And healing stopped being a special case: a device that
 * was off for a week, one whose storage was evicted mid-write, one that got a truncated
 * response, all simply hold day counts that no longer match, and the next pass fetches
 * exactly the days that are wrong.
 */

const API = '/api/mt5';

/** How often the archives are brought forward. Matches the publisher's own cycle. */
const REFRESH_MS = 30 * 60 * 1000;

/**
 * Retry gap while the publisher is still backfilling.
 *
 * It fills one symbol at a time, roughly a minute apart, so a device starting up during that
 * window would otherwise sit on an empty chart for half an hour waiting for a symbol that
 * arrived ninety seconds later.
 */
const PENDING_RETRY_MS = 60_000;

/** Retry ladder after a failed request. Starts fast, because a failure is usually a blip. */
const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/**
 * Whether the published store is answering.
 *
 * Three states. There is no address for this build to be missing and nothing to reconnect —
 * the next request either succeeds or it does not.
 */
export type BridgeStatus = 'connecting' | 'live' | 'offline';

/**
 * Where a symbol is in its fill.
 *
 * `empty` is the one that matters for diagnosis: the store answered, and the answer was that
 * it holds no candles for this symbol — it is still waiting its turn in the publisher's
 * backfill queue, or the broker does not offer it. Different from not being able to ask.
 */
export type DownloadState = 'missing' | 'downloading' | 'ready' | 'empty';

interface WireInstrument {
  symbol: string;
  broker: string;
  description: string;
  group: string;
  digits: number;
  point: number;
  contract_size: number;
  spread: number;
  volume_min: number;
  volume_max: number;
  volume_step: number;
}

/** `{symbol: {"2026-08-22": candleCount}}` — what the publisher holds, day by day. */
type Manifest = Record<string, Record<string, number>>;

interface MetaReply {
  symbols: WireInstrument[];
  /** The guaranteed depth in minute candles. `days` also arrives, but only for display. */
  candles: number;
  days: number;
  updated: number;
  manifest: Manifest;
}

export interface BridgeOptions {
  /** Fires after a symbol's archive changes, so anything drawing it can reseed. */
  onArchiveChanged?: (symbol: string) => void;
  /** Fires when a symbol's fill state changes, so the chart can show or clear its spinner. */
  onDownloadState?: (symbol: string, state: DownloadState) => void;
  onError?: (message: string) => void;
  onStatus?: (status: BridgeStatus) => void;
  /** Fires with the published instrument list, so the app can offer exactly those. */
  onCatalogue?: (symbols: string[]) => void;
}

/** Thrown for any non-2xx, carrying whatever the route said went wrong. */
class BridgeError extends Error {}

export class BridgeDownloader {
  private symbols: string[] = [];
  private running = false;
  private status: BridgeStatus = 'offline';

  /** True while the worker is mid-pass. Everything funnels through one pass at a time. */
  private working = false;
  /** Set when something asks for work while a pass is already running. */
  private again = false;

  private retry = RETRY_MIN_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  /** Digits per symbol, from the catalogue. Needed to scale candles into the archive. */
  private digits = new Map<string, number>();
  /** Everything the publisher offers, whether or not this device is watching it. */
  private published = new Set<string>();
  /** The publisher's day counts. The other half of every sync decision. */
  private manifest: Manifest = {};
  private catalogued = false;

  /** The symbol on screen. Synced first, so the chart being looked at fills first. */
  private priority: string | null = null;
  /** Symbols the store says it has not published yet. Checked back on sooner. */
  private pending = new Set<string>();
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  private options: BridgeOptions;

  constructor(options: BridgeOptions = {}) {
    this.options = options;
  }

  /* ---------- lifecycle ---------- */

  start(): void {
    if (this.running) return;
    this.running = true;

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      document.addEventListener('visibilitychange', this.handleVisibility);
    }

    this.refreshTimer = setInterval(() => void this.work(), REFRESH_MS);
    this.setStatus('connecting');
    void this.work();
  }

  stop(): void {
    this.running = false;

    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.clearRetry();
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      document.removeEventListener('visibilitychange', this.handleVisibility);
    }

    this.setStatus('offline');
  }

  /**
   * Set the symbols to keep archives for.
   *
   * Removing one here does not delete its archive — the user may put it back, and the data
   * is a one-time cost worth keeping.
   */
  setSymbols(symbols: string[]): void {
    this.symbols = [...new Set(symbols)];
    void this.work();
  }

  /**
   * Say which symbol is on screen. It goes first.
   *
   * The first thing a user does on a cold install is look at one chart, and that chart's
   * window is the only download standing between them and a usable app.
   */
  setPriority(symbol: string | null): void {
    if (!symbol || this.priority === symbol) return;
    this.priority = symbol;
    void this.work();
  }

  getStatus(): BridgeStatus {
    return this.status;
  }

  /** Everything the publisher offers. Empty until the catalogue has landed. */
  getPublished(): string[] {
    return [...this.published];
  }

  /** Bring every archive forward. The half-hourly pass, and on waking. */
  refreshAll(): void {
    void this.work();
  }

  /* ---------- the worker ---------- */

  /** Watched symbols, charted one first. */
  private ordered(): string[] {
    if (!this.priority || !this.symbols.includes(this.priority)) return this.symbols;
    return [this.priority, ...this.symbols.filter((symbol) => symbol !== this.priority)];
  }

  /**
   * One pass: read the catalogue, then bring every watched symbol level with it.
   *
   * Strictly serial, so the charted symbol is served first and the UI can say which symbol
   * it is waiting on. Most passes make exactly one request — the catalogue — because most
   * of the time nothing the device holds has gone out of date.
   */
  private async work(): Promise<void> {
    if (!this.running) return;

    if (this.working) {
      this.again = true;
      return;
    }

    this.working = true;
    this.clearRetry();

    try {
      // Re-read every pass, not once. The depth, the instrument specs, the published set and
      // the day counts are all the publisher's to change, and this is the request that learns
      // about every one of them. It is cached at the edge, so asking often costs nothing.
      await this.fetchCatalogue();

      for (const symbol of this.ordered()) {
        if (!this.running) break;
        await this.syncSymbol(symbol);
      }

      this.retry = RETRY_MIN_MS;
      this.schedulePending();
    } catch (err) {
      // Nothing is lost and nothing blocks: the app keeps trading the archive it holds.
      this.setStatus('offline');
      this.options.onError?.(
        err instanceof Error ? err.message : 'The market data store is unreachable.'
      );
      this.scheduleRetry();
    } finally {
      this.working = false;
    }

    if (this.again) {
      this.again = false;
      void this.work();
    }
  }

  private scheduleRetry(): void {
    if (!this.running || this.retryTimer) return;

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.work();
    }, this.retry);

    this.retry = Math.min(this.retry * 2, RETRY_MAX_MS);
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /* ---------- requests ---------- */

  private async request(path: string): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${API}/${path}`, { cache: 'no-store' });
    } catch {
      throw new BridgeError('Could not reach the app server to fetch market data.');
    }

    if (!response.ok) {
      // The routes answer failures as {"error": "..."} and those sentences name the actual
      // problem — nothing published yet, store unreachable — which is worth far more to the
      // user than a status code.
      let detail = `The market data store returned ${response.status}.`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body?.error) detail = body.error;
      } catch {
        /* not JSON; the generic line stands */
      }
      throw new BridgeError(detail);
    }

    this.setStatus('live');
    return response;
  }

  private async fetchCatalogue(): Promise<void> {
    const response = await this.request('meta');
    const meta = (await response.json()) as MetaReply;
    if (!Array.isArray(meta?.symbols)) return;

    // The depth comes from the publisher, not from a setting on this device. It is set
    // before any candles are stored, so the very first trim already uses the right number.
    setPublishedCandles(meta.candles);
    this.manifest = meta.manifest ?? {};

    await Promise.all(
      meta.symbols.map(async (item) => {
        if (!item?.symbol) return;
        this.digits.set(item.symbol, item.digits);
        this.published.add(item.symbol);

        const spec: InstrumentSpec = {
          broker: item.broker,
          description: item.description,
          group: item.group,
          digits: item.digits,
          point: item.point,
          contractSize: item.contract_size,
          spread: item.spread,
          volumeMin: item.volume_min,
          volumeMax: item.volume_max,
          volumeStep: item.volume_step,
        };
        await recordSpec(item.symbol, spec);
      })
    );

    if (!this.catalogued) {
      this.catalogued = true;
      console.info(
        `[archive] publisher offers ${this.published.size} symbols, ` +
          `${meta.candles.toLocaleString()} candles each`
      );
    }
    this.options.onCatalogue?.([...this.published]);
  }

  /**
   * Bring one symbol level with what the publisher holds.
   *
   * The whole sync is the diff below: every published day whose candle count this device
   * does not already match. On a first fill that is the entire window and costs one request;
   * on a normal pass it is the one day still forming; over a weekend it is nothing at all
   * and no request is made.
   */
  private async syncSymbol(symbol: string): Promise<void> {
    const published = this.manifest[symbol];

    if (!published || Object.keys(published).length === 0) {
      // The store answered, and the answer was that it holds nothing for this symbol yet —
      // the publisher fills one symbol at a time. Per-symbol, and it resolves on its own.
      if (this.published.has(symbol)) this.pending.add(symbol);
      this.options.onDownloadState?.(symbol, 'empty');
      return;
    }
    this.pending.delete(symbol);

    const digits = this.digits.get(symbol);
    if (digits === undefined) return; // catalogue has not landed; nothing to scale candles by

    // Read from storage before diffing: a symbol first seen this session has an archive on
    // disk and an empty one in memory, and the difference is a needless 1 MB download.
    await loadArchive(symbol);

    /*
     * Days this device is short of.
     *
     * Short of, not merely different from — the test is `<`, and the asymmetry is load
     * bearing. At the far end of the queue the publisher counts only part of a day, and its
     * count of it shrinks by thirty every time thirty new candles push in at the front. This
     * device holds that day in full until its own cap trims it, so between the two it
     * legitimately holds *more* of that day than the manifest claims. Testing for inequality
     * would read that as staleness and re-download the same day every half hour, for ever.
     * Holding more resolves itself on the next merge; holding less is the only thing worth a
     * request.
     */
    const held = heldDays(symbol);
    const stale = Object.keys(published)
      .filter((day) => (held[day] ?? 0) < published[day])
      .sort();

    if (stale.length === 0) {
      this.options.onDownloadState?.(symbol, needsFullDownload(symbol) ? 'empty' : 'ready');
      return;
    }

    const first = needsFullDownload(symbol);
    if (first) this.options.onDownloadState?.(symbol, 'downloading');

    try {
      const response = await this.request(
        `bars?symbol=${encodeURIComponent(symbol)}&days=${stale.join(',')}`
      );
      const text = await response.text();
      await applyCsv(symbol, digits, text);

      console.info(
        `[archive] ${symbol}: ${stale.length} day(s) updated${first ? ' (first fill)' : ''}`
      );
      this.announce(symbol);
    } catch (err) {
      if (first) this.options.onDownloadState?.(symbol, 'missing');
      throw err; // let the pass back off rather than grinding through a store that is down
    }
  }

  /**
   * Come back sooner for anything the publisher has not written yet.
   *
   * Separate from the error ladder, because this is not a failure: the store is answering
   * perfectly, it simply does not hold this symbol yet. Waiting out the full half-hour cycle
   * for something that lands a minute later is the difference between an app that looks
   * broken on first launch and one that fills in as you watch.
   */
  private schedulePending(): void {
    if (!this.running || this.pendingTimer || this.pending.size === 0) return;

    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      void this.work();
    }, PENDING_RETRY_MS);
  }

  private announce(symbol: string): void {
    this.options.onDownloadState?.(symbol, needsFullDownload(symbol) ? 'empty' : 'ready');
    this.options.onArchiveChanged?.(symbol);
  }

  /* ---------- status ---------- */

  private setStatus(status: BridgeStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatus?.(status);
  }

  /** A regained network or a foregrounded tab should not wait out the remaining backoff. */
  private handleOnline = (): void => {
    if (!this.running) return;
    this.clearRetry();
    this.retry = RETRY_MIN_MS;
    void this.work();
  };

  private handleVisibility = (): void => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') return;

    // Coming back to the app is the moment its archives are most likely to be behind.
    this.handleOnline();
  };
}
