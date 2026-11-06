# MT5 Replica

A personal MetaTrader 5-style trading simulator, built as an iPhone-first PWA. It replays real
M1 candles from an Exness trial account, synthesises ticks inside each minute, and runs a full
order engine on top of them: market and pending orders, SL/TP, swap, margin and stop-out.

Market data comes from the **seeder** in [`MT5 replica Seeder/`](MT5%20replica%20Seeder/README.md),
which publishes candles from a real MT5 terminal into Upstash Redis.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000  (also reachable on your LAN)
npm run build        # production build
npm run start        # serve the production build
```

Always use the npm scripts. They go through `scripts/next.mjs`, which fixes Windows path casing
and forces IPv4 for outbound calls.

### Environment (`.env.local`; `.env.production` for deploys)

| Variable | Purpose |
|---|---|
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | The Upstash database. Holds the trading books **and** the market data the seeder publishes. It must be the same database as the seeder's `MARKET_UPSTASH_REDIS_REST_*`. |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | The single sign-in credential. The login screen auto-submits at 6 characters. |
| `MT5_LIVE_URL` (optional) | Where the seeder's live feed is, e.g. `ws://203.0.113.5:8765`. Without it, a page opened over plain http (localhost, or the LAN address on a phone) uses `ws://<same host>:8765`, so local testing needs nothing set. If the feed cannot be reached the app uses the database, after giving a dropped link 90 seconds to come back. |

## How it works

```
Seeder ─┬─ live WebSocket, every closed minute  → LiveFeed          lib/market/live.ts     (tried first)
        └─ Redis every 15 min (mt5:meta, mt5:manifest, mt5:m1:<SYM>:<day> CSV)
             → GET /api/mt5/meta, /api/mt5/bars   app/api/mt5/*
             → BridgeDownloader                   lib/market/bridge.ts   (fallback: downloads only days this device is short of)
  → IndexedDB M1 archive                       lib/market/archive.ts  (fixed 60,000-candle queue per symbol)
  → PlaybackSession                            lib/market/session.ts  (replays at 5× × speed slider, synthesises ticks)
  → MarketStore                                lib/market/store.ts    (quotes, per-timeframe candle series, React hooks)
  → TradingStore + engine                      lib/trading/*          (book, orders, SL/TP, swap, margin, rewind)
  → screens                                    components/{quotes,chart,trade,history,settings}
```

- **Two sources, one archive:** the live feed and the database both deliver closed M1 candles
  only, and the archive merges by timestamp, so a candle has one value whichever path brought it.
  The database only fetches days this device holds fewer bars of, so it never undoes what the
  live feed delivered; when the feed is lost it quietly fills the gap. Nothing is shown to the
  user. A new device gets each symbol's newest day first, then fills backwards in 5,000-bar chunks.
  An HTTPS deployment needs a `wss://` feed address; with a `ws://` one it simply uses the database.
- **Instruments:** XAUUSD, BTCUSD, EURUSD, GBPUSD, USDJPY, AUDUSD (whatever the seeder publishes).
  Built-in specs live in `lib/instruments.ts`; the broker's real specs override them via `mt5:meta`.
- **Time:** all timestamps are UTC. The broker's server clock is UTC too.
- **Book persistence:** open positions and balance go to localStorage (instant first paint), the
  full book with history goes to IndexedDB, and a copy is mirrored to Redis under
  `mt5:book:acct:<account number>` (7-day TTL) so a reinstall finds it.
- **Auth:** one credential pair and an HMAC-signed 30-day cookie (`lib/auth/session.ts`). No database.
- **Chart setup mode:** long-press the `•••` corner on the chart for the replay window: seek,
  start time and speed.
- **Autotrader:** `lib/trading/autotrader.ts`, switched on in Settings → Automated Trading.

## Project layout

```
app/            Next.js routes: page, layout, manifest, api/{auth,book,mt5}
components/     Screens and UI, one folder per tab plus ui/ and icons/
lib/            market/ (data + playback), trading/ (engine + store), auth/, storage, db, account
public/         sw.js (hand-written service worker), icons, splash screens, fonts
scripts/        next.mjs (CLI wrapper), generate-splash.mjs, purge-auth.mjs
docs/           CODE_AUDIT.md: known bugs, what was fixed, what is still open
references/     design reference screenshot
```

## Further reading

- [`docs/CODE_AUDIT.md`](docs/CODE_AUDIT.md): bug list with fixes and open issues.
- [`CLAUDE.md`](CLAUDE.md): design system (type scale, colours, layout) and notes for AI assistants.
