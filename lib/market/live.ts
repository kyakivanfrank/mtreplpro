'use client';

import { readSetting, writeSetting } from '@/lib/storage';
import { applyCsv, archiveRange, heldDays, loadArchive, setPublishedCandles } from './archive';
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
 * minutes instead of every minute, and whatever had already arrived stays. Nothing is deleted
 * when the link drops, ever.
 *
 * A drop is not a switch. The link is redialled every few seconds, and only if it is still down
 * after `GRACE_MS` does the database take over. A blip (a phone changing networks, the seeder
 * restarted) is bridged without anyone noticing, and the reconnect fetches exactly the minutes
 * that closed while it was away.
 *
 * ── How a device fills ───────────────────────────────────────────────
 *
 * History is pulled newest-first. On connecting, every watched symbol first gets the bars
 * since the newest one it holds (or, on an empty device, its newest day), with the charted
 * symbol first, so the present is right everywhere within a second or two. An empty device
 * keeps walking backwards in 5,000-bar chunks, which a chart scrolled back shows filling in.
 *
 * Then each symbol is checked day by day: the seeder says how many bars it holds on every day,
 * the archive says how many it holds, and every day this device is short of is fetched, newest
 * first. A new device, one whose data was deleted, one that was off for a week and one with a
 * hole in the middle all heal through that same comparison. Each request starts from what the
 * archive actually holds, so a link lost halfway through simply picks up where it stopped.
 *
 * ── Where the seeder is ─────────────────────────────────────────────
 *
 * `MT5_LIVE_URL` in the app server's environment, handed over by `/api/mt5/meta`. Without it,
 * a page opened over plain http (localhost, or the dev server's LAN address on a phone) dials
 * the seeder on the same host, port 8765, so testing needs no setup at all.
 *
 * A page served over https (any deployment) is not allowed to open a plain `ws://` connection,
 * so it reaches the same feed through its own server instead (`RelaySocket`, `/api/mt5/live`):
 * the same messages, carried over https requests, with the minute push replaced by one small
 * poll just after each minute closes. Everything else in this file cannot tell the difference.
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
}

const PROTOCOL = 1;

/** Remembered, so a reload reaches the seeder before the database has even answered. */
const URL_KEY = 'market.liveUrl.v2';

/** The seeder's port when the address comes from the page itself (see `defaultUrl`). */
const DEFAULT_PORT = 8765;

/** How long to wait for the seeder before letting the database go ahead. */
const CONNECT_TIMEOUT_MS = 4_000;

/** The seeder may hold a deep request while it is still reading its window from the terminal. */
const REQUEST_TIMEOUT_MS = 120_000;

/** The seeder sends a heartbeat every 20 s; three missed means the link is dead. */
const SILENCE_MS = 65_000;

/**
 * How long a dropped link is given to come back before the database takes over. Redialled the
 * whole time; reconnecting inside it fetches whatever closed meanwhile, and nothing else happens.
 */
const GRACE_MS = 90_000;

const RETRY_MIN_MS = 3_000;
/** A seeder started after the app is found within this long. */
const RETRY_MAX_MS = 30_000;

/** First request per symbol: one trading day, so the present lands fast. */
const HEAD_CHUNK = 1_440;
/** Every request after that. */
const DEEP_CHUNK = 5_000;

interface HistoryReply {
  type: string;
  id: number;
  symbol: string;
  csv: string;
  count: number;
  oldest: number;
  done: boolean;
}

interface DaysReply {
  type: string;
  id: number;
  symbol: string;
  days: Record<string, number>;
  /** False while the seeder is still reading its full window. */
  loaded?: boolean;
}

interface MetaMessage {
  type: 'meta';
  symbols: WireInstrument[];
  candles: number;
}

/** One history request: the bars with after < t < before. */
interface Span {
  before: number;
  after: number;
  limit: number;
}

interface Progress {
  /** `head`: catching up to the present. `days`: fetching every day this device is short of. */
  phase: 'head' | 'days' | 'done';
  /** Head only: ask for bars older than this (0 = the newest). */
  cursor: number;
  /** The newest bar held when this connection began. The head stops once it reaches it. */
  heldTo: number;
  started: boolean;
  /** Days phase: the requests still to make, newest first. Null until the counts arrive. */
  queue: Span[] | null;
}

/** What this file needs of a WebSocket. `RelaySocket` provides the same over https requests. */
interface Link {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

interface Pending {
  resolve: (reply: HistoryReply & DaysReply) => void;
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

/** In place of an address: reach the seeder through this app's own server. */
const RELAY = 'relay';
const RELAY_API = '/api/mt5/live';
/** A connect through the relay goes app server -> seeder, possibly from a cold start. */
const RELAY_CONNECT_TIMEOUT_MS = 15_000;
const RELAY_REQUEST_TIMEOUT_MS = 25_000;
/** Polled this long after each minute ends: the seeder counts a minute closed 5 s after. */
const RELAY_POLL_OFFSET_MS = 7_000;
const RELAY_HEARTBEAT_MS = 20_000;

/**
 * The live feed through `/api/mt5/live`, for a page that may not open `ws://` itself.
 *
 * Speaks exactly what the seeder's socket speaks: `hello` is answered with `meta`, `history` and
 * `days` with their replies, and while it is up a `bars` message arrives just after every
 * minute closes (from the seeder's newest bars; `LiveFeed` ignores the ones already held) and
 * an `hb` every 20 s. Any failed request closes it, which `LiveFeed` treats like a dropped
 * socket: quick redials inside the grace period, then the database.
 *
 * The poll is skipped while the page is hidden and made at once when it is shown again, so a
 * phone in a pocket costs nothing.
 */
class RelaySocket implements Link {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  private done = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private beatTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    setTimeout(() => {
      if (!this.done) this.onopen?.();
    }, 0);
  }

  send(data: string): void {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(data);
    } catch {
      return;
    }

    if (body.type === 'hello') {
      void this.call({ op: 'meta' }).then((meta) => {
        if (!meta) return;
        this.deliver(meta);
        this.startPush();
      });
      return;
    }

    if (body.type === 'history' || body.type === 'days') {
      const { type, id, ...rest } = body;
      void this.call({ op: type, ...rest }).then((reply) => {
        if (reply) this.deliver({ ...reply, id });
      });
    }
  }

  close(): void {
    if (this.done) return;
    this.done = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.beatTimer) clearInterval(this.beatTimer);
    this.pollTimer = this.beatTimer = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisible);
    }
    setTimeout(() => this.onclose?.(), 0);
  }

  private async call(params: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) query.set(key, String(value));
    }
    try {
      const response = await fetch(`${RELAY_API}?${query}`, {
        signal: AbortSignal.timeout(RELAY_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`relay ${response.status}`);
      return (await response.json()) as Record<string, unknown>;
    } catch {
      this.close();
      return null;
    }
  }

  private deliver(message: unknown): void {
    if (!this.done) this.onmessage?.({ data: JSON.stringify(message) });
  }

  private startPush(): void {
    if (this.done) return;
    this.beatTimer = setInterval(() => this.deliver({ type: 'hb' }), RELAY_HEARTBEAT_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisible);
    }
    this.schedulePoll();
  }

  private schedulePoll(): void {
    if (this.done) return;
    const now = Date.now();
    const next = Math.floor(now / 60_000) * 60_000 + 60_000 + RELAY_POLL_OFFSET_MS;
    this.pollTimer = setTimeout(this.poll, next - now);
  }

  private poll = async (): Promise<void> => {
    this.pollTimer = null;
    if (this.done) return;
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      const latest = await this.call({ op: 'latest' });
      if (!latest) return;
      this.deliver(latest);
    }
    this.schedulePoll();
  };

  private onVisible = (): void => {
    if (this.done || typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    void this.poll();
  };
}

const DAY_SECONDS = 86_400;

function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / 1000;
}

/**
 * The requests that bring this device level with the seeder's day counts, newest first.
 *
 * Every day held short (`<`, never `!=`: holding more of a day than the seeder's window counts
 * is normal at its far end) is fetched. Neighbouring short days share a request up to one deep
 * chunk, so an empty window costs a dozen requests rather than fifty.
 */
function shortfall(served: Record<string, number>, held: Record<string, number>): Span[] {
  const days = Object.keys(served).sort();
  const spans: Span[] = [];
  let from = '';
  let to = '';
  let bars = 0;

  const flush = () => {
    if (!bars) return;
    spans.push({
      after: dayStart(from) - 1,
      before: dayStart(to) + DAY_SECONDS,
      // Slack for bars that close between the count and the request.
      limit: Math.min(bars + 120, 10_000),
    });
    bars = 0;
  };

  for (let i = days.length - 1; i >= 0; i--) {
    const day = days[i];
    const want = served[day];
    if ((held[day] ?? 0) >= want) {
      flush();
      continue;
    }
    if (bars && bars + want <= DEEP_CHUNK) {
      from = day;
      bars += want;
    } else {
      flush();
      from = to = day;
      bars = want;
    }
  }
  flush();
  return spans;
}

/**
 * The seeder on the page's own host, for a page opened over plain http: localhost on the
 * machine running everything, or the dev server's LAN address on a phone. An https page may
 * only open `wss://`, so it gets no default and needs `MT5_LIVE_URL`.
 */
function defaultUrl(): string | null {
  if (typeof location === 'undefined' || location.protocol !== 'http:') return null;
  return `ws://${location.hostname}:${DEFAULT_PORT}`;
}

export class LiveFeed {
  private options: LiveOptions;
  private running = false;
  private url: string | null = null;

  private ws: Link | null = null;
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
  /** Running while a dropped link is being given time to come back (see `GRACE_MS`). */
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private waiters: (() => void)[] = [];

  constructor(options: LiveOptions) {
    this.options = options;
  }

  /* ---------- lifecycle ---------- */

  start(): void {
    if (this.running) return;
    this.running = true;

    const remembered = readSetting<string | null>(URL_KEY, null);
    this.url = remembered === RELAY || usable(remembered) ? remembered : defaultUrl();

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
    this.clearGrace();
    if (this.ws) this.drop(this.ws);
    this.settle();
  }

  /**
   * The configured address, from `/api/mt5/meta` (`MT5_LIVE_URL`). Nothing configured falls
   * back to `defaultUrl`. A link that is up is never torn down for losing its address: the
   * seeder is plainly there. It is only not redialled once it drops.
   */
  setEndpoint(url: string | null | undefined): void {
    // One address this page may dial is dialled directly. Anything else goes through the app's
    // own server: a plain ws:// address from an https page (which the browser would block), or
    // a list of several (`ws://home:8765,ws://vps:8765`), where the server finds the one that
    // is running.
    const list = (url ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
    const configured =
      list.length === 1 && usable(list[0]) ? list[0] : list.length > 0 ? RELAY : null;
    writeSetting<string | null>(URL_KEY, configured);
    const next = configured ?? defaultUrl();
    if (next === this.url) return;

    this.url = next;
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

  /** Connected, or dropped but still inside its grace period: the live feed is the source. */
  isOpen(): boolean {
    return this.open || this.graceTimer !== null;
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

    const relay = this.url === RELAY;
    let ws: Link;
    try {
      ws = relay ? new RelaySocket() : (new WebSocket(this.url) as unknown as Link);
    } catch {
      this.scheduleRetry();
      return;
    }

    this.ws = ws;
    this.connecting = true;
    this.connectTimer = setTimeout(
      () => {
        if (!this.open) this.drop(ws);
      },
      relay ? RELAY_CONNECT_TIMEOUT_MS : CONNECT_TIMEOUT_MS
    );

    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', v: PROTOCOL }));
    ws.onmessage = (event) => this.receive(ws, event.data);
    ws.onclose = () => this.closed(ws);
    ws.onerror = () => {
      /* a close event always follows */
    };
  }

  private drop(ws: Link): void {
    try {
      ws.close();
    } catch {
      /* already closing */
    }
    this.closed(ws);
  }

  private closed(ws: Link): void {
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
    if (wasOpen && this.running) {
      // Not lost yet: redial fast, and hand over to the database only if this runs out.
      this.retry = RETRY_MIN_MS;
      this.clearGrace();
      this.graceTimer = setTimeout(() => {
        this.graceTimer = null;
        if (!this.open) this.options.onLink(false);
      }, GRACE_MS);
    }
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
    if (!this.graceTimer) this.retry = Math.min(this.retry * 2, RETRY_MAX_MS);
  }

  private clearGrace(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
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

  private armSilence(ws: Link): void {
    this.lastMessage = Date.now();
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => this.drop(ws), SILENCE_MS);
  }

  /* ---------- messages ---------- */

  private receive(ws: Link, data: unknown): void {
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
      case 'history':
      case 'days': {
        const reply = message as unknown as HistoryReply & DaysReply;
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
    this.clearGrace();
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
      // Only what this device does not hold yet. A relayed poll repeats the last few minutes
      // every time, and re-applying them would redraw the chart for nothing.
      const newest = archiveRange(symbol).to;
      const fresh = csv
        .split('\n')
        .filter((line) => Number(line.slice(0, line.indexOf(','))) > newest)
        .join('\n');
      if (fresh) void this.apply(symbol, fresh);
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
      progress = { phase: 'head', cursor: 0, heldTo: held.to, started: false, queue: null };
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

      if (reply.done || reply.count < limit) {
        // Joined up with what was held (or the seeder has nothing older): the present is in.
        progress.phase = 'days';
      } else {
        progress.cursor = reply.oldest; // still a gap between this and what is held
      }
      return true;
    }

    // Days: whatever this device is still short of, by the seeder's own per-day counts.
    if (!progress.queue) {
      let counts = await this.request({ type: 'days', symbol });
      // The seeder is still reading its full window (it has just started): ask again shortly
      // rather than settle for the part it has so far.
      for (let tries = 0; counts.loaded === false && tries < 24 && this.open; tries++) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        counts = await this.request({ type: 'days', symbol });
      }
      progress.queue = shortfall(counts.days ?? {}, heldDays(symbol));
    }
    const span = progress.queue.shift();
    if (!span) {
      this.finish(symbol, progress);
      return false;
    }
    const reply = await this.history(symbol, span.before, span.after, span.limit);
    await this.apply(symbol, reply.csv);
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
    return this.request({ type: 'history', symbol, before, after, limit });
  }

  private request(body: Record<string, unknown>): Promise<HistoryReply & DaysReply> {
    const ws = this.ws;
    if (!ws || !this.open) return Promise.reject(new Error('live feed closed'));

    const id = this.nextId++;
    return new Promise<HistoryReply & DaysReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error('live feed request timed out'));
        this.drop(ws);
      }, REQUEST_TIMEOUT_MS);

      this.requests.set(id, { resolve, reject, timer });
      try {
        ws.send(JSON.stringify({ ...body, id }));
      } catch {
        this.drop(ws);
      }
    });
  }
}
