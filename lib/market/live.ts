'use client';

import { readSetting, writeSetting } from '@/lib/storage';
import { applyCsv, archiveCandles, archiveRange, loadArchive, setPublishedCandles } from './archive';
import { recordSpec, type InstrumentSpec } from './meta';
// Type-only: erased at build, so this is not a runtime cycle with bridge.ts.
import type { DownloadState } from './bridge';

/* ------------------------------------------------------------------ */
/*  The live feed                                                      */
/* ------------------------------------------------------------------ */
/**
 * The first of the two ways candles reach this device, and the fast one.
 *
 *   live      a WebSocket to the seeder itself. Every closed minute arrives as it closes.
 *   database  Upstash through `/api/mt5/*`, refreshed every fifteen minutes (`bridge.ts`).
 *
 * Both write into the same minute archive, and neither knows the other exists as far as the
 * charts are concerned: the session plays whatever the archive holds. That is what makes
 * switching between them invisible. The two never disagree about a candle, because the
 * seeder publishes closed minutes only on both paths, and the archive merges by timestamp,
 * so a minute delivered twice is the same minute stored once.
 *
 * The database is the fallback, and it never fights this feed. It only fetches days this
 * device holds *fewer* bars of than it does, so a device the live feed has carried ahead of it
 * is left alone, and a device that lost the feed is topped up with exactly what it is short.
 * Nothing is ever announced to the user: a lost link means candles arrive every fifteen
 * minutes instead of every minute, and whatever had already arrived stays.
 *
 * ── How a device fills ───────────────────────────────────────────────
 *
 * History is pulled newest-first. On connecting, every watched symbol first gets the bars
 * since the newest one it holds (or, on an empty device, its newest day), with the charted
 * symbol first, so the present is right everywhere within a second or two. Then each symbol is
 * deepened backwards in 5,000-bar chunks until it holds the full published window, which a
 * chart scrolled back shows filling in. Each request starts from what the archive actually
 * holds, so a link lost halfway through simply picks up where it stopped.
 *
 * Intentionally not live in the tick sense: no prices inside a minute come over this link. The
 * session synthesizes those from each minute's OHLC, exactly as it does for database candles.
 */

/** The broker spec as both the seeder and `/api/mt5/meta` send it. */
export interface WireInstrument {
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

export function specFromWire(item: WireInstrument): InstrumentSpec {
  return {
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
}

export interface LiveOptions {
  onArchiveChanged: (symbol: string) => void;
  onDownloadState: (symbol: string, state: DownloadState) => void;
  /** The symbols the seeder serves, with their digits. */
  onCatalogue: (symbols: string[], digits: Map<string, number>) => void;
  /** The link came up (true) or was lost (false). */
  onLink: (open: boolean) => void;
  /** Every watched symbol is level with the seeder; the database pass may cross-check. */
  onIdle: () => void;
  /**
   * An attempt failed before the link came up. The address held may be from an earlier run of
   * the seeder (its public address is new every run), so it is worth looking up again.
   */
  onUnreachable: () => void;
}

const PROTOCOL = 1;

/** Remembered, so a reload reaches the seeder before the database has even answered. */
const URL_KEY = 'market.liveUrl';

/** How long to wait for the seeder before letting the database go ahead. */
const CONNECT_TIMEOUT_MS = 4_000;

/** The seeder may hold a deep request while it is still reading its window from the terminal. */
const REQUEST_TIMEOUT_MS = 120_000;

/** The seeder sends a heartbeat every 20 s; three missed means the link is dead. */
const SILENCE_MS = 65_000;

const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 60_000;

/** First request per symbol: one trading day, so the present lands fast. */
const HEAD_CHUNK = 1_440;
/** Every request after that. */
const DEEP_CHUNK = 5_000;

interface HistoryReply {
  type: 'history';
  id: number;
  symbol: string;
  csv: string;
  count: number;
  oldest: number;
  done: boolean;
}

interface MetaMessage {
  type: 'meta';
  symbols: WireInstrument[];
  candles: number;
}

interface Progress {
  /** `head`: catching up to the present. `depth`: filling backwards. */
  phase: 'head' | 'depth' | 'done';
  /** Head only: ask for bars older than this (0 = the newest). */
  cursor: number;
  /** The newest bar held when this connection began. The head stops once it reaches it. */
  heldTo: number;
  started: boolean;
}

interface Pending {
  resolve: (reply: HistoryReply) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Whether this page may open `url` at all: an HTTPS page can only open `wss://`. */
function usable(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'wss:') return true;
    if (parsed.protocol !== 'ws:') return false;
    if (typeof location === 'undefined' || location.protocol !== 'https:') return true;
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export class LiveFeed {
  private options: LiveOptions;
  private running = false;
  private url: string | null = null;

  private ws: WebSocket | null = null;
  private open = false;
  private connecting = false;
  private lastMessage = 0;

  private symbols: string[] = [];
  private priority: string | null = null;
  /** Digits per symbol the seeder serves. Also the set of symbols this feed is responsible for. */
  private digits = new Map<string, number>();

  private progress = new Map<string, Progress>();
  /** Pushed bars for symbols whose first request has not landed yet. Applied right after it. */
  private buffered = new Map<string, string[]>();
  private headLanded = new Set<string>();

  private requests = new Map<number, Pending>();
  private nextId = 1;

  private pumping = false;
  private pumpAgain = false;

  private retry = RETRY_MIN_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private waiters: (() => void)[] = [];

  constructor(options: LiveOptions) {
    this.options = options;
  }

  /* ---------- lifecycle ---------- */

  start(): void {
    if (this.running) return;
    this.running = true;

    const remembered = readSetting<string | null>(URL_KEY, null);
    this.url = usable(remembered) ? remembered : null;

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.wake);
      document.addEventListener('visibilitychange', this.wake);
    }
    this.connect();
  }

  stop(): void {
    this.running = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.wake);
      document.removeEventListener('visibilitychange', this.wake);
    }
    this.clearRetry();
    if (this.ws) this.drop(this.ws);
    this.settle();
  }

  /**
   * The address the seeder advertises, from `/api/mt5/meta`. `null` means no seeder is serving.
   *
   * A link that is up is never torn down because the advertisement lapsed: the seeder is
   * plainly there. It is only not redialled once it drops.
   */
  setEndpoint(url: string | null | undefined): void {
    const next = usable(url) ? url : null;
    if (next === this.url) return;

    this.url = next;
    writeSetting<string | null>(URL_KEY, next);

    if (next === null) return;
    if (this.ws) this.drop(this.ws);
    this.retry = RETRY_MIN_MS;
    this.connect();
  }

  setSymbols(symbols: string[]): void {
    this.symbols = [...new Set(symbols)];
    if (this.open) void this.pump();
  }

  setPriority(symbol: string | null): void {
    if (symbol) this.priority = symbol;
  }

  isOpen(): boolean {
    return this.open;
  }

  /** True while this feed is bringing `symbol` level. The database leaves it alone meanwhile. */
  isFilling(symbol: string): boolean {
    return this.open && this.digits.has(symbol) && this.progress.get(symbol)?.phase !== 'done';
  }

  /**
   * Resolves once the first attempt has an answer: the link is up, or it failed, or there is no
   * address to try. Bounded by the connect timeout, so the database is never held up for long.
   */
  settled(): Promise<void> {
    if (!this.connecting) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /* ---------- the link ---------- */

  private connect(): void {
    if (!this.running || !this.url || this.ws) return;
    this.clearRetry();

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }

    this.ws = ws;
    this.connecting = true;
    this.connectTimer = setTimeout(() => {
      if (!this.open) this.drop(ws);
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', v: PROTOCOL }));
    ws.onmessage = (event) => this.receive(ws, event.data);
    ws.onclose = () => this.closed(ws);
    ws.onerror = () => {
      /* a close event always follows */
    };
  }

  private drop(ws: WebSocket): void {
    try {
      ws.close();
    } catch {
      /* already closing */
    }
    this.closed(ws);
  }

  private closed(ws: WebSocket): void {
    if (ws !== this.ws) return;
    this.ws = null;

    const wasOpen = this.open;
    this.open = false;
    this.connecting = false;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.connectTimer = this.silenceTimer = null;

    for (const pending of this.requests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('live feed closed'));
    }
    this.requests.clear();
    this.progress.clear();
    this.buffered.clear();
    this.headLanded.clear();

    this.settle();
    if (wasOpen) this.options.onLink(false);
    else if (this.running) this.options.onUnreachable();
    this.scheduleRetry();
  }

  private settle(): void {
    const waiting = this.waiters;
    this.waiters = [];
    waiting.forEach((resolve) => resolve());
  }

  private scheduleRetry(): void {
    if (!this.running || !this.url || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, this.retry);
    this.retry = Math.min(this.retry * 2, RETRY_MAX_MS);
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** Back in the foreground or back online: redial now rather than wait out the backoff. */
  private wake = (): void => {
    if (!this.running) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

    // A phone that slept can hold a socket that looks open and is long dead.
    if (this.ws && this.open && Date.now() - this.lastMessage > SILENCE_MS) {
      this.drop(this.ws);
    }
    if (!this.ws) {
      this.retry = RETRY_MIN_MS;
      this.connect();
    }
  };

  private armSilence(ws: WebSocket): void {
    this.lastMessage = Date.now();
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => this.drop(ws), SILENCE_MS);
  }

  /* ---------- messages ---------- */

  private receive(ws: WebSocket, data: unknown): void {
    if (ws !== this.ws || typeof data !== 'string') return;
    this.armSilence(ws);

    let message: { type?: string } & Record<string, unknown>;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }

    switch (message?.type) {
      case 'meta':
        this.handleMeta(message as unknown as MetaMessage);
        break;
      case 'history': {
        const reply = message as unknown as HistoryReply;
        const pending = this.requests.get(reply.id);
        if (pending) {
          this.requests.delete(reply.id);
          clearTimeout(pending.timer);
          pending.resolve(reply);
        }
        break;
      }
      case 'bars':
        this.handleBars(message.bars as Record<string, string>);
        break;
      default:
        break; // `hb` and anything newer: the silence timer was all it was for
    }
  }

  private handleMeta(meta: MetaMessage): void {
    if (!Array.isArray(meta?.symbols)) return;

    setPublishedCandles(meta.candles);
    this.digits.clear();
    for (const item of meta.symbols) {
      if (!item?.symbol) continue;
      this.digits.set(item.symbol, item.digits);
      void recordSpec(item.symbol, specFromWire(item));
    }
    this.options.onCatalogue([...this.digits.keys()], this.digits);

    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    this.open = true;
    this.connecting = false;
    this.retry = RETRY_MIN_MS;
    this.settle();
    this.options.onLink(true);
    void this.pump();
  }

  private handleBars(bars: Record<string, string> | undefined): void {
    if (!bars || typeof bars !== 'object') return;

    for (const [symbol, csv] of Object.entries(bars)) {
      if (typeof csv !== 'string' || !this.symbols.includes(symbol)) continue;

      // Before a symbol's first request lands its window is not laid out yet, and a lone bar
      // would seat the session at the very end of the tape. Held for a moment instead.
      if (!this.headLanded.has(symbol)) {
        const queue = this.buffered.get(symbol) ?? [];
        queue.push(csv);
        this.buffered.set(symbol, queue);
        continue;
      }
      void this.apply(symbol, csv);
    }
  }

  /* ---------- filling ---------- */

  private ordered(): string[] {
    const served = this.symbols.filter((symbol) => this.digits.has(symbol));
    if (!this.priority || !served.includes(this.priority)) return served;
    return [this.priority, ...served.filter((symbol) => symbol !== this.priority)];
  }

  /** Every symbol's present first, then every symbol's depth. One request in flight at a time. */
  private async pump(): Promise<void> {
    if (this.pumping) {
      this.pumpAgain = true;
      return;
    }
    this.pumping = true;

    try {
      do {
        this.pumpAgain = false;
        for (const symbol of this.ordered()) {
          if (!this.open) return;
          await this.step(symbol, true);
        }
        for (const symbol of this.ordered()) {
          while (this.open && (await this.step(symbol, false))) {
            /* one chunk per iteration */
          }
        }
      } while (this.pumpAgain && this.open);

      if (this.open) this.options.onIdle();
    } catch {
      // The link dropped mid-request. `closed` has already reset everything and scheduled the
      // redial, and the database pass fills whatever this one did not reach.
    } finally {
      this.pumping = false;
    }
  }

  /** One request for `symbol`. Returns whether it has more to do. */
  private async step(symbol: string, firstOnly: boolean): Promise<boolean> {
    if (!this.digits.has(symbol)) return false;

    let progress = this.progress.get(symbol);
    if (!progress) {
      await loadArchive(symbol);
      const held = archiveRange(symbol);
      progress = { phase: 'head', cursor: 0, heldTo: held.to, started: false };
      this.progress.set(symbol, progress);
      if (held.count === 0) this.options.onDownloadState(symbol, 'downloading');
    }

    if (progress.phase === 'done') return false;
    if (firstOnly && progress.started) return false;
    progress.started = true;

    if (progress.phase === 'head') {
      const limit = progress.cursor === 0 ? HEAD_CHUNK : DEEP_CHUNK;
      const reply = await this.history(symbol, progress.cursor, progress.heldTo, limit);
      await this.apply(symbol, reply.csv);

      if (!this.headLanded.has(symbol)) {
        this.headLanded.add(symbol);
        const queued = this.buffered.get(symbol);
        this.buffered.delete(symbol);
        if (queued?.length) await this.apply(symbol, queued.join('\n'));
        if (archiveRange(symbol).count > 0) this.options.onDownloadState(symbol, 'ready');
      }

      if (reply.done) {
        this.finish(symbol, progress); // the seeder holds nothing older at all
        return false;
      }
      if (reply.count < limit) {
        progress.phase = 'depth'; // everything since `heldTo` has arrived: joined up
      } else {
        progress.cursor = reply.oldest; // still a gap between this and what is held
      }
      return true;
    }

    // Depth: below the oldest bar held, until the archive holds the published window.
    const held = archiveRange(symbol);
    if (held.count === 0 || held.count >= archiveCandles()) {
      this.finish(symbol, progress);
      return false;
    }

    const reply = await this.history(symbol, held.from, 0, DEEP_CHUNK);
    await this.apply(symbol, reply.csv);
    if (reply.done || reply.count === 0) {
      this.finish(symbol, progress);
      return false;
    }
    return true;
  }

  private finish(symbol: string, progress: Progress): void {
    progress.phase = 'done';
    this.options.onDownloadState(symbol, archiveRange(symbol).count > 0 ? 'ready' : 'empty');
  }

  private async apply(symbol: string, csv: string): Promise<void> {
    const digits = this.digits.get(symbol);
    if (!csv || digits === undefined) return;
    await applyCsv(symbol, digits, csv);
    this.options.onArchiveChanged(symbol);
  }

  private history(
    symbol: string,
    before: number,
    after: number,
    limit: number
  ): Promise<HistoryReply> {
    const ws = this.ws;
    if (!ws || !this.open) return Promise.reject(new Error('live feed closed'));

    const id = this.nextId++;
    return new Promise<HistoryReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error('live feed request timed out'));
        this.drop(ws);
      }, REQUEST_TIMEOUT_MS);

      this.requests.set(id, { resolve, reject, timer });
      try {
        ws.send(JSON.stringify({ type: 'history', id, symbol, before, after, limit }));
      } catch {
        this.drop(ws);
      }
    });
  }
}
