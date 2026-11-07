'use client';

import { applyCsv, archiveRange, loadArchive } from './archive';

/* ------------------------------------------------------------------ */
/*  The minute feed                                                    */
/* ------------------------------------------------------------------ */
/**
 * Every closed candle, a few seconds after its minute ends.
 *
 * The seeder writes each M1 bar to the database as soon as its minute closes, and moves the
 * feed's `through` forward once a minute. Just after every minute boundary this asks
 * `/api/mt5/latest` for the newest few bars of every symbol. The app's server caches that answer
 * at the edge until the next minute is due, so the database is read about once a minute however
 * many devices are open, and nothing is metered per device.
 *
 * Only bars that join on to what this device already holds are applied here. A device that has
 * been away longer than the answer reaches back (asleep, offline, a tab left in the background)
 * is handed to the downloader (`bridge.ts`) instead, which fetches exactly the days it is short
 * of. The same goes for an empty device: its first fill is the downloader's.
 *
 * Polls are skipped while the page is hidden. The downloader runs a pass when it is shown
 * again, and that pass ends by polling here, so a phone in a pocket costs nothing.
 *
 * Intentionally not live in the tick sense: no prices inside a minute come over this. The
 * session synthesizes those from each minute's OHLC.
 */

const API = '/api/mt5/latest';

/** Polled this long after each minute ends: the seeder counts a quiet minute closed 5 s after. */
const POLL_OFFSET_MS = 7_000;

/** The seeder is running but has not written the minute yet: ask again this soon, this often. */
const LAG_RETRY_MS = 4_000;
const LAG_RETRIES = 4;

/** After a failed request. */
const ERROR_RETRY_MS = 15_000;

const REQUEST_TIMEOUT_MS = 15_000;

/** What `/api/mt5/latest` answers. */
export interface LatestReply {
  /** Every minute that ended at or before this unix second has been written. */
  through: number;
  /** The seeder moved `through` within the last few minutes: candles are arriving. */
  live: boolean;
  /** `{symbol: "t,o,h,l,c,v\n..."}`, the newest bars, oldest first. */
  bars: Record<string, string>;
}

export interface MinuteOptions {
  /** The symbols this device keeps archives for. */
  symbols: () => string[];
  /** Price digits per symbol, from the catalogue. A symbol without them is skipped. */
  digits: (symbol: string) => number | undefined;
  onArchiveChanged: (symbol: string) => void;
  /** A symbol's newest bars do not join what is held: the downloader should fill the gap. */
  onGap: () => void;
  /** Every answer, or null for a failed request. */
  onReply: (reply: LatestReply | null) => void;
}

export class MinuteFeed {
  private options: MinuteOptions;
  private running = false;
  private inflight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lagTries = 0;

  constructor(options: MinuteOptions) {
    this.options = options;
  }

  /** Begins with the next minute. `pollNow` asks straight away. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(untilNextPoll());
  }

  stop(): void {
    this.running = false;
    this.clear();
  }

  pollNow(): void {
    if (!this.running) return;
    this.clear();
    void this.poll();
  }

  private clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(ms: number): void {
    this.clear();
    if (this.running) this.timer = setTimeout(() => void this.poll(), ms);
  }

  private async poll(): Promise<void> {
    this.timer = null;
    if (!this.running || this.inflight) return;

    // Hidden: skip, and wait to be woken (see the note at the top).
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      this.schedule(untilNextPoll());
      return;
    }

    this.inflight = true;
    let next = untilNextPoll();
    try {
      const reply = await fetchLatest();
      await this.apply(reply.bars);
      this.options.onReply(reply);

      // The seeder is running and the minute that just ended is not in yet: it is a few seconds
      // late (a slow network on its side). Ask again shortly rather than wait a whole minute.
      const expected = Math.floor((Date.now() - POLL_OFFSET_MS) / 60_000) * 60;
      if (reply.live && reply.through < expected && this.lagTries < LAG_RETRIES) {
        this.lagTries++;
        next = LAG_RETRY_MS;
      } else {
        this.lagTries = 0;
      }
    } catch {
      this.options.onReply(null);
      next = Math.min(next, ERROR_RETRY_MS);
    } finally {
      this.inflight = false;
    }
    this.schedule(next);
  }

  private async apply(bars: Record<string, string>): Promise<void> {
    let gap = false;

    for (const symbol of this.options.symbols()) {
      const csv = bars[symbol];
      const digits = this.options.digits(symbol);
      if (!csv || digits === undefined) continue;

      await loadArchive(symbol);
      const held = archiveRange(symbol);
      if (held.count === 0) continue; // the first fill is the downloader's

      const lines = csv.split('\n').filter(Boolean);
      const times = lines.map((line) => Number(line.slice(0, line.indexOf(','))));

      // Joins on only if the answer reaches back to (or right up to) the newest bar held.
      // Otherwise there are minutes missing in between, and those are the downloader's.
      if (times[0] > held.to + 60) {
        gap = true;
        continue;
      }

      const fresh = lines.filter((_, i) => times[i] > held.to);
      if (fresh.length === 0) continue;

      await applyCsv(symbol, digits, fresh.join('\n'));
      this.options.onArchiveChanged(symbol);
    }

    if (gap) this.options.onGap();
  }
}

/** Milliseconds until the next poll is due: `POLL_OFFSET_MS` after a minute boundary. */
function untilNextPoll(): number {
  const now = Date.now();
  const minute = Math.floor(now / 60_000) * 60_000;
  const due = minute + POLL_OFFSET_MS;
  return (now < due ? due : due + 60_000) - now;
}

async function fetchLatest(): Promise<LatestReply> {
  // Not `no-store`: the edge cache is the whole point, and the route sets its lifetime.
  const response = await fetch(API, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`latest ${response.status}`);
  const body = (await response.json()) as Partial<LatestReply>;
  return {
    through: Number(body.through) || 0,
    live: body.live === true,
    bars: body.bars && typeof body.bars === 'object' ? body.bars : {},
  };
}
