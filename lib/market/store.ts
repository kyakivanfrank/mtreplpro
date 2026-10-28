'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { findInstrument } from '@/lib/instruments';
import { CandleSeries } from './candles';
import { BridgeDownloader, type BridgeStatus, type DownloadState } from './bridge';
import { PlaybackSession, type PlaybackState } from './session';
import { archiveRange, barAt, loadArchive, primeArchives, seriesAt, wipeAllArchives } from './archive';
import { primeMetaCache, recordView } from './meta';
import { isMarketOpen } from './sessions';
import { STORAGE_KEYS, readSetting, scopedKey, writeSetting } from '@/lib/storage';
import { accountScope, accountStore } from '@/lib/account';
import { requestPersistence } from '@/lib/db';
import { sessionOffsetFor, TIMEFRAMES } from './timeframes';
import { SYMBOLS } from '@/lib/symbols';
import type { Candle, TimeframeKey, Tick, TickHandler } from './types';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface QuoteState {
  symbol: string;
  display: string;
  digits: number;
  bid: number;
  ask: number;
  spread: number;
  high: number;
  low: number;
  changePoints: number;
  changePercent: number;
  /** Unix ms of the last tick — session time, not wall-clock. */
  time: number;
  /** Direction of the last tick, which is what colours bid/ask in MT5. */
  direction: 'up' | 'down';
}

const EMPTY_QUOTES: Record<string, QuoteState> = {};
const EMPTY_SERIES: Candle[] = [];

/** Where the last seen prices are kept so a cold launch isn't blank. */
const QUOTES_KEY = 'market.quotes';

/** How long the board can go unwritten. See `persistQuotes`. */
const QUOTES_PERSIST_MS = 5_000;

/**
 * How many bars of a given timeframe a chart is seeded with.
 *
 * Every series is rolled out of the minute archive, so the real ceiling is the archive itself —
 * a month of minutes is only about 180 H4 bars. These caps exist for M1, where handing
 * lightweight-charts forty thousand bars in one call stalls the render for no benefit: nobody
 * scrolls ten thousand minutes in a sitting, and rolling a coarser view is what zooming out is
 * for.
 */
/**
 * How many bars a chart may hold, per timeframe.
 *
 * Sized to cover the *whole* published archive rather than a comfortable screenful. The
 * budget is what decides how far back you can scroll behind the playhead, and 10,000 minutes
 * is only about seven days of a window that holds twenty-five — so setting the start marker
 * anywhere earlier than that left the history in front of it simply absent from the chart,
 * looking as though the session had hidden it. It had not; it was never seeded.
 *
 * 36,000 M1 candles is what the publisher guarantees, and the coarser frames are that number
 * divided down, so every one of them reaches the same distance back.
 */
const CHART_MAX_BARS: Partial<Record<TimeframeKey, number>> = { M1: 40_000, M5: 8_000 };
const DEFAULT_MAX_BARS = 4_000;

function maxBarsFor(timeframe: TimeframeKey): number {
  return CHART_MAX_BARS[timeframe] ?? DEFAULT_MAX_BARS;
}

/**
 * What a chart can say about one symbol, and why.
 *
 * The last three are all "no bars", and they are deliberately separate: the fix for each is
 * different, and a screen that says "no data" to all three tells the user nothing they can act
 * on. Every one of them is about this instrument alone — anything already downloaded keeps
 * charting and trading.
 */
export type SymbolState =
  /** Bars are drawn. */
  | 'ready'
  /** This symbol's own download is in flight. */
  | 'downloading'
  /** The store is answering; this symbol is waiting behind another one's download. */
  | 'queued'
  /** The store answered, and it holds no candles for this symbol yet. */
  | 'no-data'
  /** The store did not answer, so nothing can be asked for. */
  | 'no-bridge';

/** The day's range and yesterday's close, which ticks alone cannot produce. */
interface DayStats {
  /** Unix seconds at the open of the session day the clock is inside. */
  dayStart: number;
  high: number;
  low: number;
  prevClose: number;
}

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */
/**
 * One archive in, one clock over it, every view out.
 *
 * There is no longer a live path and a backtest path. The bridge downloads minute bars into
 * local storage and nothing else; the playback session walks those bars at wall-clock rate; the
 * store folds the resulting ticks into a bar series per symbol and timeframe. Charts, the quote
 * board and the order engine all read the same clock, so the whole terminal is at one moment in
 * market time and a trade placed on a chart is priced by the same tick the watchlist shows.
 *
 * What this buys is the thing that made minute trading unusable before: nothing re-syncs. The
 * bars a chart is drawing were downloaded once and are not going to change underneath it. Every
 * timeframe is bucketed from the same minute array, so switching M1 to H4 cannot disagree with
 * itself and cannot land on an empty chart.
 */
class MarketStore {
  private listeners = new Set<() => void>();

  /** Symbol interest per subscriber, so two mounted views can't clobber each other's list. */
  private subscriptions = new Map<string, string[]>();
  private symbols: string[] = [];
  private quotes: Record<string, QuoteState> = {};
  private series = new Map<string, CandleSeries>();
  private snapshots = new Map<string, Candle[]>();
  private dayStats = new Map<string, DayStats>();

  private downloader: BridgeDownloader | null = null;
  private session: PlaybackSession | null = null;
  private playback: PlaybackState = {
    startMs: 0,
    endMs: 0,
    clockMs: 0,
    playing: false,
    ready: false,
    speed: 1,
  };

  /**
   * Draw past the clock, up to this moment, while the window is being set.
   *
   * Zero the rest of the time, and that is the important half: a chart that shows candles the
   * session has not reached is a chart showing the future, which is the one thing a replay must
   * never do. It is allowed only while the panel is open — you cannot choose where a window
   * should stop without seeing what is there to stop at — and the bars it exposes are drawn
   * faded, so what has happened and what has not are never the same thing on screen.
   */
  private previewMs = 0;

  private downloads = new Map<string, DownloadState>();
  /**
   * Every instrument the terminal publishes.
   *
   * The app can only chart what is being published, so this is what the symbol picker
   * offers rather than the full built-in catalogue — an instrument nobody is sending bars
   * for is a chart that can only ever say "no data".
   */
  private published: string[] = [];
  private status: BridgeStatus = 'offline';
  private bridgeError: string | null = null;

  /**
   * Anyone who needs the raw tick stream rather than a rendered snapshot — the order engine.
   * Kept separate from `listeners` because these must fire on every tick, not once per frame:
   * a stop that is only checked at 60fps would be a stop that slips.
   */
  private tickListeners = new Set<TickHandler>();

  /**
   * Told when the session jumps backwards, so the book can be cleared.
   *
   * A listener rather than a direct call into the trading store, which already imports this
   * module — the dependency only runs one way.
   */
  private wipeListeners = new Set<(toMs: number) => void>();

  private flushScheduled = false;
  private quotesPersistTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private quotesHydrated = false;

  /* ---------- subscription plumbing ---------- */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getQuotes = (): Record<string, QuoteState> => this.quotes;

  getQuote = (symbol: string): QuoteState | undefined => this.quotes[symbol];

  getSeries = (symbol: string, timeframe: TimeframeKey): Candle[] =>
    this.snapshots.get(key(symbol, timeframe)) ?? EMPTY_SERIES;

  getPlayback = (): PlaybackState => this.playback;

  getDownload = (symbol: string): DownloadState => this.downloads.get(symbol) ?? 'missing';

  getBridgeStatus = (): BridgeStatus => this.status;

  /** Everything the terminal publishes. Empty until the catalogue lands. */
  getPublished = (): string[] => this.published;

  /** The store's last complaint, verbatim, for a chart that has to explain itself. */
  getBridgeMessage = (): string | null => this.bridgeError;

  /**
   * What a chart should say about one symbol.
   *
   * Per symbol, never app-wide. Data arrives one instrument at a time — the charted one first,
   * then the rest of the watchlist in turn — so a terminal where gold is fully downloaded and
   * bitcoin has not started is the normal state during a first run, not a failure. Anything
   * that blocked the whole app on it would be blocking on a queue.
   */
  getSymbolState = (symbol: string): SymbolState => {
    const download = this.downloads.get(symbol) ?? 'missing';
    if (download === 'ready') return 'ready';
    if (download === 'downloading') return 'downloading';
    if (download === 'empty') return 'no-data';

    // Nothing held. Whether that is worth worrying about depends on whether the store is
    // answering at all.
    if (this.status === 'connecting' || this.status === 'live') return 'queued';
    return 'no-bridge';
  };

  /**
   * Whether this instrument is inside a minute it actually traded.
   *
   * The clock is one clock for the whole terminal, but the calendars underneath it are not the
   * same: bitcoin trades through the weekend and the currency pairs do not. So a session that
   * keeps running on Saturday is correct — it is following the only instrument with a market
   * open — while every forex chart beside it holds its Friday close and draws a flat line.
   *
   * That line is real and belongs there. What was missing was any way to tell it apart from a
   * broken feed, which is what this answers: false means "shut", not "no data".
   */
  getTradeable = (symbol: string): boolean => {
    const clockMs = this.playback.clockMs;
    if (!clockMs) return false;
    return barAt(symbol, Math.floor(clockMs / 1000))?.covers ?? false;
  };

  /**
   * Market time. Every order is stamped with it.
   *
   * It is the session's clock, never `Date.now()`: a trade taken during playback of Tuesday
   * morning has to read as Tuesday morning in the history afterwards.
   */
  getClock = (): number => this.playback.clockMs || Date.now();

  /**
   * Kept for the trading store, which keys its book by mode.
   *
   * There is only one book now. The old split existed because the Strategy Tester was a
   * separate world entered by hand; playback *is* the world, so a trade taken in it is simply
   * a trade on the account.
   */
  getMode = (): 'live' => 'live';

  /** Subscribe to the raw tick stream. Used by the order engine, never by a view. */
  onTick = (listener: TickHandler): (() => void) => {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  };

  /** Told when a backwards seek has invalidated part of the book, and how far back it went. */
  onWipeRequired = (listener: (toMs: number) => void): (() => void) => {
    this.wipeListeners.add(listener);
    return () => this.wipeListeners.delete(listener);
  };

  /**
   * Ticks can arrive faster than the screen refreshes, so notifications are coalesced to one
   * per frame. Without this a twelve-tick bar would trigger twelve renders.
   */
  private notify(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;

    const flush = () => {
      this.flushScheduled = false;
      this.listeners.forEach((listener) => listener());
    };

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
    else setTimeout(flush, 16);
  }

  /* ---------- lifecycle ---------- */

  /**
   * Bring the terminal up: warm the caches, start the downloader, lay out the window.
   *
   * Idempotent, because every view calls it on mount. The archives are read before the session
   * is initialised — the window's default position is derived from what the device actually
   * holds, so asking before the read would put it over nothing.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    this.hydrateQuotes();
    void requestPersistence();

    this.session = new PlaybackSession(this.handleTick, {
      onState: (state) => {
        this.playback = state;
        this.notify();
      },
      onSeek: () => this.reseedAll(),
      onSeekBackwards: (toMs) => this.wipeListeners.forEach((listener) => listener(toMs)),
    });

    this.downloader = new BridgeDownloader({
      onArchiveChanged: (symbol) => this.handleArchiveChanged(symbol),
      onDownloadState: (symbol, state) => {
        this.downloads.set(symbol, state);
        this.notify();
      },
      // Nothing blocks on this. A chart with no bars for its symbol says so itself, and the
      // rest of the terminal keeps trading whatever it already holds.
      onError: (message) => {
        console.warn(`[bridge] ${message}`);
        this.bridgeError = message;
        this.notify();
      },
      onCatalogue: (symbols) => {
        this.published = symbols;
        this.notify();
      },
      onStatus: (status) => {
        this.status = status;
        // A request that got through supersedes whatever the last failure said, so a chart
        // is never left explaining an outage that has since resolved.
        if (status === 'live') this.bridgeError = null;
        this.notify();
      },
    });

    this.primeWatchlist();

    /*
     * Follow the account, so the warm set is the incoming account's watchlist rather than the
     * outgoing one's.
     *
     * Without this, the symbols kept downloading and playing from launch would stay whatever
     * the account at launch was watching. The Quotes screen would look right the moment it was
     * opened — its own list is account-scoped — but every other screen would be running on the
     * wrong set until then, which is the kind of wrong that only shows up as a chart that
     * takes a moment too long to fill.
     */
    accountStore.hydrate();
    accountStore.subscribe(() => this.primeWatchlist());

    void (async () => {
      // Specs first: digits and spreads come from the broker, and a frame rendered before they
      // land would price everything off the built-in fallbacks.
      await primeMetaCache();
      await primeArchives(this.symbols);

      this.session?.init(this.symbols);
      this.reseedAll();
      this.downloader?.setSymbols(this.symbols);
      this.downloader?.start();
      this.notify();
    })();

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibility);
    }
  }

  private handleVisibility = (): void => {
    // The most likely moment for the process to be killed, and for the user to come back to a
    // cold launch — so the board is written now rather than on the next timer.
    if (document.visibilityState === 'hidden') this.flushQuotes();
  };

  /** A refresh appended bars: extend the window if it is following, and redraw what changed. */
  private handleArchiveChanged(symbol: string): void {
    this.session?.noteArchiveGrowth();

    for (const seriesKey of this.series.keys()) {
      if (seriesKey.startsWith(`${symbol}|`)) this.reseed(seriesKey);
    }

    this.dayStats.delete(symbol);
    this.notify();
  }

  /* ---------- symbols ---------- */

  /**
   * Keep the watchlist warm for the whole session, whatever screen is open.
   *
   * Views subscribe on mount and release on unmount, and the tab bar unmounts the screen it
   * leaves. Registering the saved watchlist under its own subscriber id means those symbols are
   * downloaded and playing from launch rather than starting over each time a screen is visited.
   */
  private primeWatchlist(): void {
    const rows = readSetting<{ symbol: string }[] | null>(
      scopedKey(STORAGE_KEYS.watchlist, accountScope()),
      null
    );
    const symbols = (rows ?? [])
      .map((row) => row?.symbol)
      .filter((symbol): symbol is string => typeof symbol === 'string' && symbol.length > 0);

    this.setWatchlist(symbols.length ? symbols : [...SYMBOLS]);
  }

  /** Replace the always-warm set. A symbol added here starts its one-time download at once. */
  setWatchlist(symbols: string[]): void {
    this.setSymbols('watchlist', symbols);
  }

  /** Register a subscriber's symbols. The downloader tracks the union of every list. */
  setSymbols(subscriberId: string, symbols: string[]): void {
    this.subscriptions.set(subscriberId, symbols);
    this.syncSymbols();
  }

  releaseSymbols(subscriberId: string): void {
    this.subscriptions.delete(subscriberId);
    this.syncSymbols();
  }

  private syncSymbols(): void {
    const next = [...new Set([...this.subscriptions.values()].flat())].filter(Boolean);
    if (next.join() === this.symbols.join()) return;

    this.symbols = next;
    this.session?.setSymbols(next);
    this.downloader?.setSymbols(next);

    // A symbol added after launch has no archive in memory yet; once it is read the session may
    // be able to lay out a window for the first time.
    void (async () => {
      await primeArchives(next);
      this.session?.noteArchiveGrowth();
      this.notify();
    })();
  }

  /** Note which symbol is charted: it jumps the download queue and resists archive eviction. */
  setChartSymbol(symbol: string | null): void {
    this.downloader?.setPriority(symbol);
    if (symbol) void recordView(symbol);
  }

  /* ---------- series ---------- */

  /**
   * Open a symbol/timeframe series.
   *
   * Seeded straight out of the archive at the current clock — no network, no waiting, and never
   * empty as long as the symbol has been downloaded. Series are kept once opened, so switching
   * back to a timeframe is free and it stayed current the whole time: every open series consumes
   * the same tick stream.
   */
  async openSeries(symbol: string, timeframe: TimeframeKey): Promise<void> {
    const seriesKey = key(symbol, timeframe);
    if (this.series.has(seriesKey)) return;

    // The cap has to match what the archive is asked for, or the seed would be sliced down
    // to the series' own default the moment it lands.
    this.series.set(
      seriesKey,
      new CandleSeries(
        TIMEFRAMES[timeframe].seconds,
        maxBarsFor(timeframe),
        // D1 opens at 21:00, not midnight, and W1 and MN inherit that instant. Passed here so
        // ticks extend the bar the archive laid down instead of opening a second one beside it.
        sessionOffsetFor(timeframe)
      )
    );

    // The archive may not have been read yet — a chart can open on a symbol the watchlist
    // never carried.
    await loadArchive(symbol);

    this.reseed(seriesKey);
    this.refreshDayStats(symbol);
    this.notify();
  }

  /**
   * Rebuild one series from the archive at the current clock.
   *
   * Rebuilding rather than appending is what makes seeking work at all: a clock that jumped
   * backwards cannot be walked there by ticks, and one that jumped forwards would otherwise
   * leave a hole. It is a single pass over data already in memory.
   */
  private reseed(seriesKey: string): void {
    const series = this.series.get(seriesKey);
    if (!series) return;

    // The session's clock, not `getClock()`: before the window is laid out that falls back to
    // wall-clock, and seeding at wall-clock would paint every bar the archive holds — including
    // the hours the session has not revealed yet.
    const clockMs = this.playback.clockMs;
    if (!clockMs) return;

    const [symbol, timeframe] = seriesKey.split('|') as [string, TimeframeKey];
    const clockSeconds = Math.floor(Math.max(clockMs, this.previewMs) / 1000);

    series.seed(seriesAt(symbol, timeframe, clockSeconds, maxBarsFor(timeframe)));
    this.snapshots.set(seriesKey, series.all());
  }

  private reseedAll(): void {
    for (const seriesKey of this.series.keys()) this.reseed(seriesKey);
    for (const symbol of this.symbols) this.dayStats.delete(symbol);
    this.notify();
  }

  /* ---------- ticks ---------- */

  private handleTick = (tick: Tick): void => {
    const instrument = findInstrument(tick.symbol);
    const previous = this.quotes[tick.symbol];
    const digits = instrument?.digits ?? 5;

    const direction: 'up' | 'down' = previous
      ? tick.bid > previous.bid
        ? 'up'
        : tick.bid < previous.bid
          ? 'down'
          : previous.direction
      : 'up';

    const stats = this.dayStatsFor(tick.symbol, tick);
    const point = instrument?.point ?? 10 ** -digits;

    this.quotes = {
      ...this.quotes,
      [tick.symbol]: {
        symbol: tick.symbol,
        display: instrument?.display ?? tick.symbol.replace('/', ''),
        digits,
        bid: tick.bid,
        ask: tick.ask,
        spread: Math.round((tick.ask - tick.bid) / point),
        high: stats.high,
        low: stats.low,
        changePoints: stats.prevClose ? Math.round((tick.bid - stats.prevClose) / point) : 0,
        changePercent: stats.prevClose
          ? ((tick.bid - stats.prevClose) / stats.prevClose) * 100
          : 0,
        time: tick.time,
        direction,
      },
    };

    this.persistQuotes();

    // A closed session must not open a bar. The session still prints a price for a shut market
    // — it holds the last close, exactly as a real quote board does — but no candle forms.
    if (!isMarketOpen(tick.symbol, tick.time)) {
      this.notify();
      return;
    }

    // The same tick advances every timeframe this symbol has open, which is what puts the
    // motion on M1 and H4 alike without a second data source.
    for (const [seriesKey, candles] of this.series) {
      if (!seriesKey.startsWith(`${tick.symbol}|`)) continue;
      if (candles.applyTick(tick) !== 'stale') this.snapshots.set(seriesKey, candles.all());
    }

    // Orders and stops are evaluated against every tick, not once a frame.
    this.tickListeners.forEach((listener) => listener(tick));

    this.notify();
  };

  /**
   * The day's high, low and previous close for a symbol at the current clock.
   *
   * Derived from the archive once per session day, then carried forward by the ticks
   * themselves. Recomputing it per tick would mean decoding two days of minutes four times a
   * second for every symbol on the board.
   */
  private dayStatsFor(symbol: string, tick: Tick): DayStats {
    const seconds = Math.floor(tick.time / 1000);
    const existing = this.dayStats.get(symbol);

    if (existing && seconds >= existing.dayStart && seconds < existing.dayStart + 86_400) {
      const high = Math.max(existing.high, tick.bid);
      const low = Math.min(existing.low, tick.bid);
      if (high !== existing.high || low !== existing.low) {
        const updated = { ...existing, high, low };
        this.dayStats.set(symbol, updated);
        return updated;
      }
      return existing;
    }

    return this.refreshDayStats(symbol) ?? { dayStart: seconds, high: tick.bid, low: tick.bid, prevClose: 0 };
  }

  /** Read the day's figures out of the archive. The daily bar carries all three. */
  private refreshDayStats(symbol: string): DayStats | undefined {
    if (!this.playback.clockMs) return undefined;
    const clockSeconds = Math.floor(this.playback.clockMs / 1000);
    const days = seriesAt(symbol, 'D1', clockSeconds, 2);
    const today = days[days.length - 1];
    if (!today) return undefined;

    const stats: DayStats = {
      dayStart: today.time,
      high: today.high,
      low: today.low,
      prevClose: days.length > 1 ? days[days.length - 2].close : today.open,
    };

    this.dayStats.set(symbol, stats);
    return stats;
  }

  /* ---------- the board on disk ---------- */

  /**
   * Restore the last prices seen on this device, so a cold launch opens on the market the user
   * left rather than on dashes. Playback overwrites them within a frame.
   */
  hydrateQuotes(): void {
    if (this.quotesHydrated) return;
    this.quotesHydrated = true;

    const stored = readSetting<Record<string, QuoteState> | null>(QUOTES_KEY, null);
    if (!stored || Object.keys(stored).length === 0) return;

    this.quotes = { ...stored, ...this.quotes };
    this.notify();
  }

  /**
   * Throttled, and deliberately not written per tick: localStorage is synchronous, so writing
   * four times a second across a watchlist would put a serialise-and-store on the main thread
   * continuously. Losing the last few seconds on a hard kill costs nothing.
   */
  private persistQuotes(): void {
    if (this.quotesPersistTimer) return;

    this.quotesPersistTimer = setTimeout(() => {
      this.quotesPersistTimer = null;
      writeSetting(QUOTES_KEY, this.quotes);
    }, QUOTES_PERSIST_MS);
  }

  flushQuotes = (): void => {
    if (this.quotesPersistTimer) {
      clearTimeout(this.quotesPersistTimer);
      this.quotesPersistTimer = null;
    }
    writeSetting(QUOTES_KEY, this.quotes);
  };

  /* ---------- transport ---------- */

  /**
   * Play and pause are global on purpose.
   *
   * Pressing play on one chart starts the whole terminal: every symbol advances on the same
   * clock, so a limit order left resting on gold is being tested against the same moment the
   * chart in front of you is showing.
   */
  play(): void {
    this.session?.play();
  }

  pause(): void {
    this.session?.pause();
  }

  togglePlay(): void {
    this.session?.toggle();
  }

  /**
   * Draw ahead of the clock, or stop doing so.
   *
   * Purely what is rendered. The session's clock does not move, no ticks are produced for the
   * exposed bars, and the order engine never sees them — a stop cannot be filled by a candle
   * the user is only previewing.
   */
  setPreview(untilMs: number): void {
    if (this.previewMs === untilMs) return;
    this.previewMs = untilMs;
    this.reseedAll();
  }

  /** Move the clock inside the window. Backwards clears the book — see `onWipeRequired`. */
  seekTo(ms: number): void {
    this.session?.seekTo(ms);
  }

  /** How fast the one clock runs, as a multiple of normal. Remembered across launches. */
  setSpeed(speed: number): void {
    this.session?.setSpeed(speed);
  }

  /** Move the green dot. Playback restarts from there. */
  setWindowStart(ms: number): void {
    this.session?.setStart(ms);
  }

  /** Oldest and newest bar the device holds for a symbol, in ms. Bounds the window editor. */
  archiveBounds(symbol: string): { fromMs: number; toMs: number } | null {
    const range = archiveRange(symbol);
    if (range.count === 0) return null;
    return { fromMs: range.from * 1000, toMs: range.to * 1000 };
  }

  /**
   * Throw every downloaded bar away and fetch them all again.
   *
   * The point is that it never leaves the app empty. The series objects are kept and simply
   * emptied, so the chart the user walks back to is the one they left and fills itself in as
   * the download lands; the session forgets its window and lays out a fresh one over the new
   * data the moment the first symbol arrives. No reload, and nothing to press afterwards.
   */
  async resetData(): Promise<void> {
    this.session?.reset();

    for (const [seriesKey, series] of this.series) {
      series.seed([]);
      this.snapshots.set(seriesKey, []);
    }

    this.dayStats.clear();
    this.downloads.clear();
    this.quotes = {};
    writeSetting(QUOTES_KEY, {});

    await wipeAllArchives();
    this.notify();

    /*
     * Rebuild deliberately, rather than leaving it to the next timer.
     *
     * Wiping is the easy half. The half that used to be missing is putting the app back into a
     * usable state afterwards: every archive is gone, so the manifest diff now finds every day
     * of every symbol stale and re-downloads the lot — but only if something asks it to, and
     * the next scheduled pass could be half an hour away. So the pass is started here, the
     * charted symbol is put at the front of it, and the specs are re-read on the way through.
     *
     * The session is left idle on purpose. `noteArchiveGrowth` lays out a fresh window the
     * moment the first symbol lands, which is the same path a first-ever launch takes.
     */
    this.downloader?.setSymbols(this.symbols);
    this.downloader?.refreshAll();
  }

  stop(): void {
    this.session?.stop();
    this.downloader?.stop();
    this.started = false;
  }
}

function key(symbol: string, timeframe: TimeframeKey): string {
  return `${symbol}|${timeframe}`;
}

/** Module-level so every view shares one archive, one clock and one set of bars. */
export const marketStore = new MarketStore();

/* ------------------------------------------------------------------ */
/*  React bindings                                                     */
/* ------------------------------------------------------------------ */

let subscriberSeq = 0;

export function useQuotes(symbols: string[]): Record<string, QuoteState> {
  const symbolsKey = symbols.join(',');
  const idRef = useRef<string | null>(null);
  if (idRef.current === null) idRef.current = `sub-${++subscriberSeq}`;
  const id = idRef.current;

  useEffect(() => {
    marketStore.start();
    marketStore.setSymbols(id, symbolsKey.split(','));
    return () => marketStore.releaseSymbols(id);
  }, [symbolsKey, id]);

  return useSyncExternalStore(marketStore.subscribe, marketStore.getQuotes, () => EMPTY_QUOTES);
}

export function useSeries(symbol: string, timeframe: TimeframeKey): Candle[] {
  useEffect(() => {
    marketStore.start();
    marketStore.setChartSymbol(symbol);
    void marketStore.openSeries(symbol, timeframe);
  }, [symbol, timeframe]);

  const getSnapshot = useCallback(
    () => marketStore.getSeries(symbol, timeframe),
    [symbol, timeframe]
  );

  return useSyncExternalStore(marketStore.subscribe, getSnapshot, () => EMPTY_SERIES);
}

/** What this symbol's chart should show: its bars, a spinner, or an empty state that says why. */
export function useSymbolState(symbol: string): SymbolState {
  const getSnapshot = useCallback(() => marketStore.getSymbolState(symbol), [symbol]);
  return useSyncExternalStore(marketStore.subscribe, getSnapshot, () => 'queued' as SymbolState);
}

/** Everything the terminal publishes, for the pickers that must not offer more. */
const NO_SYMBOLS: string[] = [];

/** Whether a symbol's market is open at the session clock. Re-renders as the clock moves. */
export function useTradeable(symbol: string): boolean {
  return useSyncExternalStore(
    marketStore.subscribe,
    () => marketStore.getTradeable(symbol),
    () => false
  );
}

export function usePublished(): string[] {
  return useSyncExternalStore(
    marketStore.subscribe,
    marketStore.getPublished,
    () => NO_SYMBOLS
  );
}

/** The bridge's own words, shown under an empty chart so the reason is never a guess. */
export function useBridgeMessage(): string | null {
  return useSyncExternalStore(marketStore.subscribe, marketStore.getBridgeMessage, () => null);
}

const IDLE_PLAYBACK: PlaybackState = {
  startMs: 0,
  endMs: 0,
  clockMs: 0,
  playing: false,
  ready: false,
  speed: 1,
};

/** The global clock and its window. Drives the transport and the window editor. */
export function usePlayback(): PlaybackState {
  return useSyncExternalStore(
    marketStore.subscribe,
    marketStore.getPlayback,
    () => IDLE_PLAYBACK
  );
}


