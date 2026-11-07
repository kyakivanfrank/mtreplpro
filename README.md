# MT5 Replica

A personal MetaTrader 5-style trading simulator, built as an iPhone-first PWA. It replays real
M1 candles from an Exness trial account, synthesises ticks inside each minute, and runs a full
order engine on top of them: market and pending orders, SL/TP, swap, margin and stop-out.

Market data comes from the **seeder** in [`MT5 replica Seeder/`](MT5%20replica%20Seeder/README.md),
which writes every closed minute from a real MT5 terminal into a Supabase database.

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
| `SUPABASE_URL` | The Supabase project the seeder writes into (`https://<ref>.supabase.co`). Its layout is the seeder's `supabase/schema.sql`. |
| `SUPABASE_PUBLISHABLE_KEY` | Reads market data and nothing else (enforced by row-level security in the database), so it is safe in a committed env file. |
| `SUPABASE_SECRET_KEY` | Full access, used only by `/api/book` for the account mirror. Server-only: `.env.local` and the host's environment, **never a public repo**. Without it the app works in full except the server copy of each book. |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | The single sign-in credential. The login screen auto-submits at 6 characters. |

The browser never talks to Supabase: everything goes through this app's own routes.

## How it works

```
Seeder → Supabase (candles + feed), every closed minute as it closes
  → GET /api/mt5/meta     specs, depth, per-day bar counts   app/api/mt5/meta
  → GET /api/mt5/bars     one symbol's bars on named days    app/api/mt5/bars   (cached by content)
  → GET /api/mt5/latest   newest bars of every symbol        app/api/mt5/latest (polled once a minute)
  → BridgeDownloader + MinuteFeed                            lib/market/bridge.ts, minute.ts
  → IndexedDB M1 archive                       lib/market/archive.ts  (fixed 60,000-candle queue per symbol)
  → PlaybackSession                            lib/market/session.ts  (replays at 5× × speed slider, synthesises ticks)
  → MarketStore                                lib/market/store.ts    (quotes, per-timeframe candle series, React hooks)
  → TradingStore + engine                      lib/trading/*          (book, orders, SL/TP, swap, margin, rewind)
  → screens                                    components/{quotes,chart,trade,history,settings}
```

- **Two jobs, one archive.** `MinuteFeed` asks `/api/mt5/latest` a few seconds after every
  minute boundary and applies the bars that join on to what the device holds: a new candle
  shows up about 8 s after its minute closes. `BridgeDownloader` compares the database's per-day
  bar counts with the device's own and downloads only the days it is short of, newest week
  first: on start (a new device fills 6 x 60,000 candles in about 20 s), every 15 minutes, when
  the app comes back into view or online, and whenever the minute feed finds a gap.
- **One database read a minute, however many devices.** `/api/mt5/latest` is cached at the edge
  until the next minute is due, and `/api/mt5/bars` URLs name each day's bar count, so every
  device filling the same days shares one cached answer. No realtime connections, no
  per-device quota.
- **Seeder off:** the database keeps everything it wrote. Devices keep the last candles, Settings
  > Market Data > Source says `Seeder off`, and the feed picks up on its own when it returns.
- **Instruments:** XAUUSD, BTCUSD, EURUSD, GBPUSD, USDJPY, AUDUSD (whatever the seeder publishes).
  Built-in specs live in `lib/instruments.ts`; the broker's real specs override them via `/api/mt5/meta`.
- **Time:** all timestamps are UTC. The broker's server clock is UTC too.
- **Book persistence:** open positions and balance go to localStorage (instant first paint), the
  full book with history goes to IndexedDB, and a copy is mirrored to Supabase (`books`
  table, keyed by account number, dropped after a week unopened) so a reinstall finds it.
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
scripts/        next.mjs (CLI wrapper), generate-splash.mjs
docs/           CODE_AUDIT.md: known bugs, what was fixed, what is still open
references/     design reference screenshot
```

## Further reading

- [`docs/CODE_AUDIT.md`](docs/CODE_AUDIT.md): bug list with fixes and open issues.
- [`CLAUDE.md`](CLAUDE.md): design system (type scale, colours, layout) and notes for AI assistants.
