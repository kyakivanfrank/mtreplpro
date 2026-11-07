'use client';

import { recordSpec, specFromWire, type WireInstrument } from './meta';
import { MinuteFeed } from './minute';
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
 * Keeps each symbol's minute archive level with the market database.
 *
 * The seeder (a separate project, next to a MetaTrader 5 terminal on a PC or a VPS) writes every
 * closed M1 bar into Supabase as its minute ends. This app reads that database through its own
 * routes, never directly:
 *
 *   /api/mt5/meta     the instrument specs, the window depth, and the manifest: how many bars
 *                     the database holds for every symbol on every day
 *   /api/mt5/bars     one symbol's bars on named days, as CSV
 *   /api/mt5/latest   the newest bars of every symbol, polled once a minute (`minute.ts`)
 *
 * ── The manifest is the whole design ─────────────────────────────────
 *
 * The archive counts its own bars per day exactly the way the database does, so neither side
 * ever has to work out where it stopped: the difference between the two lists *is* the
 * download. A day this device is short of is fetched; a day it matches is not. A new device, one
 * whose storage was evicted, one that was off for a week and one with a hole in the middle all
 * heal through that one comparison, and a closed market costs nothing.
 *
 * ── Two jobs ─────────────────────────────────────────────────────────
 *
 *   minute   each closed candle a few seconds after its minute ends (`MinuteFeed`). What keeps
 *            a device current.
 *   passes   the day-by-day comparison: on start, every 15 minutes, when the page comes back
 *            into view or back online, and whenever the minute feed finds a gap it cannot join.
 *            What makes a device complete.
 *
 * When the seeder is off, the database still holds everything it wrote, so a device keeps the
 * last candles there are and picks up on its own when the seeder comes back. Nothing is ever
 * deleted because something could not be reached.
 */

const API = '/api/mt5';

/** How often the full comparison runs. New candles do not wait for it: see `MinuteFeed`. */
const REFRESH_MS = 15 * 60 * 1000;

/**
 * Retry gap while the seeder is still backfilling. It fills one symbol after another, a few
 * seconds each, so a device starting up meanwhile should not wait out a full refresh.
 */
const PENDING_RETRY_MS = 30_000;

/** Retry ladder after a failed request. Starts fast, because a failure is usually a blip. */
const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/**
 * How the days a device is short of are split into history requests, newest first.
 *
 * Shaped for the edge cache. A request's URL names each day with its bar count, so a URL whose
 * days never change can be shared by every device for a month, and one whose days move cannot be
 * shared at all. Two days move all the time: the newest (it grows every minute) and the oldest
 * (the seeder trims it as the window slides). Each goes in a request of its own. Everything in
 * between is final, and is grouped by fixed calendar week, so the same week is the same URL for
 * every device on every day. A new device's database reads come down to about two days per
 * symbol; the rest is served from the cache.
 *
 * A week per request also means the newest week lands, and the chart is usable, while older
 * weeks are still on their way.
 */
function requestGroups(stale: string[], published: string[]): string[][] {
  const sorted = [...published].sort();
  const newest = sorted[sorted.length - 1];
  const oldest = sorted[0];
  const week = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000 / 7);
  const key = (day: string) => (day === newest ? 'newest' : day === oldest ? 'oldest' : `w${week(day)}`);

  const groups = new Map<string, string[]>();
  for (const day of [...stale].sort().reverse()) {
    const name = key(day);
    groups.set(name, [...(groups.get(name) ?? []), day]);
  }
  return [...groups.values()].map((days) => days.sort());
}

/**
 * How often a symbol's charts are redrawn while its history streams in. Each redraw re-buckets
 * the whole archive into every open timeframe, so doing it per chunk would repeat that work a
 * dozen times over a first fill for nothing a person could see.
 */
const ANNOUNCE_MS = 1_000;

/** Whether the market database is answering. */
export type BridgeStatus = 'connecting' | 'live' | 'offline';

/**
 * Where new candles stand, for Settings:
 *
 *   live        the seeder is publishing: each candle arrives a few seconds after its minute
 *   idle        the database answers, but the seeder is not running: the last candles it wrote
 *   connecting  nothing has answered yet
 *   offline     the database cannot be reached; the device trades the candles it already holds
 */
export type FeedSource = 'live' | 'idle' | 'connecting' | 'offline';

/**
 * Where a symbol is in its fill. `empty` means the database answered and holds nothing for this
 * symbol yet (still waiting its turn in the seeder's backfill, or the broker does not offer it),
 * which is different from not being able to ask.
 */
export type DownloadState = 'missing' | 'downloading' | 'ready' | 'empty';

/** `{symbol: {"2026-08-22": candleCount}}`: what the database holds, day by day. */
type Manifest = Record<string, Record<string, number>>;

interface MetaReply {
  symbols: WireInstrument[];
  /** The window depth in minute candles. `days` also arrives, for display only. */
  candles: number;
  days: number;
  through: number;
  live: boolean;
  manifest: Manifest;
}

export interface BridgeOptions {
  /** Fires after a symbol's archive changes, so anything drawing it can reseed. */
  onArchiveChanged?: (symbol: string) => void;
  /** Fires when a symbol's fill state changes, so the chart can show or clear its spinner. */
  onDownloadState?: (symbol: string, state: DownloadState) => void;
  onError?: (message: string) => void;
  onStatus?: (status: BridgeStatus) => void;
  /** Fires when where new candles stand changes (see `FeedSource`). */
  onSource?: (source: FeedSource) => void;
  /** Fires with the published instrument list, so the app can offer exactly those. */
  onCatalogue?: (symbols: string[]) => void;
}

/** Thrown for any non-2xx, carrying whatever the route said went wrong. */
class BridgeError extends Error {}

export class BridgeDownloader {
  private symbols: string[] = [];
  private running = false;
  private status: BridgeStatus = 'offline';
  private source: FeedSource = 'offline';
  /** Whether the seeder is publishing, from the last answer that said. */
  private seederLive = false;

  /** True while a pass is running. Everything funnels through one pass at a time. */
  private working = false;
  /** Set when something asks for a pass while one is already running. */
  private again = false;

  private retry = RETRY_MIN_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  /** Digits per symbol, from the catalogue. Needed to scale candles into the archive. */
  private digits = new Map<string, number>();
  /** Everything the database offers, whether or not this device is watching it. */
  private published = new Set<string>();
  /** The database's day counts. The other half of every sync decision. */
  private manifest: Manifest = {};
  private catalogued = false;

  /** The symbol on screen. Synced first, so the chart being looked at fills first. */
  private priority: string | null = null;
  /** Symbols the database has nothing for yet. Checked back on sooner. */
  private pending = new Set<string>();
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  private options: BridgeOptions;
  private minute: MinuteFeed;

  constructor(options: BridgeOptions = {}) {
    this.options = options;
    this.minute = new MinuteFeed({
      symbols: () => this.symbols,
      digits: (symbol) => this.digits.get(symbol),
      onArchiveChanged: (symbol) => this.options.onArchiveChanged?.(symbol),
      onGap: () => this.refreshAll(),
      onReply: (reply) => {
        if (!reply) {
          this.setStatus('offline');
          return;
        }
        this.seederLive = reply.live;
        this.setStatus('live');
      },
    });
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
    this.minute.start();
    void this.work();
  }

  stop(): void {
    this.running = false;
    this.minute.stop();

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
   * Set the symbols to keep archives for. Removing one does not delete its archive: the user may
   * put it back, and the data is a one-time cost worth keeping.
   */
  setSymbols(symbols: string[]): void {
    this.symbols = [...new Set(symbols)];
    void this.work();
  }

  /**
   * Say which symbol is on screen. It goes first: on a cold install, that chart's window is the
   * only download standing between the user and a usable app.
   */
  setPriority(symbol: string | null): void {
    if (!symbol || this.priority === symbol) return;
    this.priority = symbol;
    void this.work();
  }

  getStatus(): BridgeStatus {
    return this.status;
  }

  getSource(): FeedSource {
    return this.source;
  }

  /** Everything the database offers. Empty until the catalogue has landed. */
  getPublished(): string[] {
    return [...this.published];
  }

  /** Bring every archive level with the database. */
  refreshAll(): void {
    void this.work();
  }

  /* ---------- the pass ---------- */

  /** Watched symbols, the charted one first. */
  private ordered(): string[] {
    if (!this.priority || !this.symbols.includes(this.priority)) return this.symbols;
    return [this.priority, ...this.symbols.filter((symbol) => symbol !== this.priority)];
  }

  /**
   * One pass: read the catalogue, bring every watched symbol level with it, then poll the minute
   * feed so the newest minute is in as well. Strictly serial, so the charted symbol is served
   * first. Most passes make one request, the catalogue, because nothing held is out of date.
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
      // Re-read every pass: the depth, the specs, the published set and the day counts are all
      // the seeder's to change. Cached at the edge, so asking often costs nothing.
      await this.fetchCatalogue();

      for (const symbol of this.ordered()) {
        if (!this.running) break;
        await this.syncSymbol(symbol);
      }

      this.retry = RETRY_MIN_MS;
      this.schedulePending();
      this.minute.pollNow();
    } catch (err) {
      // Nothing is lost and nothing blocks: the app keeps trading the archive it holds.
      this.setStatus('offline');
      this.options.onError?.(
        err instanceof Error ? err.message : 'The market database is unreachable.'
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
      // The routes set their own edge-cache lifetimes; the browser itself never reuses an answer.
      response = await fetch(`${API}/${path}`, { cache: 'no-store' });
    } catch {
      throw new BridgeError('Could not reach the app server to fetch market data.');
    }

    if (!response.ok) {
      // The routes answer failures as {"error": "..."}, and those sentences name the actual
      // problem, which is worth far more to the user than a status code.
      let detail = `The market database returned ${response.status}.`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body?.error) detail = body.error;
      } catch {
        /* not JSON; the generic line stands */
      }
      throw new BridgeError(detail);
    }

    return response;
  }

  private async fetchCatalogue(): Promise<void> {
    const response = await this.request('meta');
    const meta = (await response.json()) as MetaReply;
    if (!Array.isArray(meta?.symbols)) return;

    // The depth comes from the seeder, not from a setting on this device. It is set before any
    // candles are stored, so the very first trim already uses the right number.
    setPublishedCandles(meta.candles);
    this.manifest = meta.manifest ?? {};
    this.seederLive = meta.live === true;
    this.setStatus('live');

    await Promise.all(
      meta.symbols.map(async (item) => {
        if (!item?.symbol) return;
        this.digits.set(item.symbol, item.digits);
        this.published.add(item.symbol);
        await recordSpec(item.symbol, specFromWire(item));
      })
    );

    if (!this.catalogued) {
      this.catalogued = true;
      console.info(
        `[archive] database offers ${this.published.size} symbols, ` +
          `${meta.candles.toLocaleString()} candles each`
      );
    }
    this.options.onCatalogue?.([...this.published]);
  }

  /**
   * Bring one symbol level with the database: every day whose count this device does not match,
   * newest first, a week per request. On a first fill that is the whole window; on a normal pass
   * it is nothing at all, because the minute feed has kept today level.
   */
  private async syncSymbol(symbol: string): Promise<void> {
    const published = this.manifest[symbol];

    if (!published || Object.keys(published).length === 0) {
      if (this.published.has(symbol)) this.pending.add(symbol);
      this.options.onDownloadState?.(symbol, 'empty');
      return;
    }
    this.pending.delete(symbol);

    const digits = this.digits.get(symbol);
    if (digits === undefined) return; // catalogue has not landed; nothing to scale candles by

    // Read from storage before diffing: a symbol first seen this session has an archive on disk
    // and an empty one in memory, and the difference is a needless full download.
    await loadArchive(symbol);

    /*
     * Days this device is short of. Short of, not merely different from: the test is `<`, and
     * the asymmetry is load-bearing. At the far end of the window the database holds only part
     * of a day, and its count shrinks as new minutes push in at the front. This device keeps that
     * day until its own cap trims it, so it legitimately holds *more* of it than the manifest
     * says. Holding more resolves itself; holding less is the only thing worth a request.
     */
    const held = heldDays(symbol);
    const stale = Object.keys(published)
      .filter((day) => (held[day] ?? 0) < published[day])
      .sort()
      .reverse();

    if (stale.length === 0) {
      this.options.onDownloadState?.(symbol, needsFullDownload(symbol) ? 'empty' : 'ready');
      return;
    }

    const first = needsFullDownload(symbol);
    if (first) this.options.onDownloadState?.(symbol, 'downloading');

    const groups = requestGroups(stale, Object.keys(published));
    let announcedAt = 0;
    let unannounced = false;

    try {
      for (let i = 0; i < groups.length; i++) {
        if (!this.running) return;
        // Each day names the count it should hold, which makes the URL name its content: every
        // device filling the same days shares one cached answer (see /api/mt5/bars).
        const days = groups[i].map((day) => `${day}:${published[day]}`).join(',');
        const response = await this.request(`bars?symbol=${encodeURIComponent(symbol)}&days=${days}`);
        // Stored as soon as it lands: whatever has arrived is kept if a later request fails.
        await applyCsv(symbol, digits, await response.text());
        unannounced = true;

        // Redraw for the first chunk (the newest days: the chart is usable at once), then at
        // most every ANNOUNCE_MS while older weeks stream in behind it, and for the last one.
        const now = Date.now();
        if (i === 0 || i === groups.length - 1 || now - announcedAt >= ANNOUNCE_MS) {
          this.announce(symbol);
          announcedAt = now;
          unannounced = false;
        }
      }

      console.info(
        `[archive] ${symbol}: ${stale.length} day(s) updated${first ? ' (first fill)' : ''}`
      );
    } catch (err) {
      // Keep and show what did arrive; the next pass asks only for the days still short.
      if (unannounced) this.announce(symbol);
      if (first && needsFullDownload(symbol)) this.options.onDownloadState?.(symbol, 'missing');
      throw err; // let the pass back off rather than grind through a database that is down
    }
  }

  /**
   * Come back sooner for anything the database has nothing for yet. Not a failure: it answered
   * perfectly, it just does not hold this symbol yet, and it may a few seconds from now.
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
    if (this.status !== status) {
      this.status = status;
      this.options.onStatus?.(status);
    }
    this.updateSource();
  }

  private updateSource(): void {
    const source: FeedSource =
      this.status === 'live' ? (this.seederLive ? 'live' : 'idle') : this.status;
    if (source === this.source) return;
    this.source = source;
    this.options.onSource?.(source);
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
