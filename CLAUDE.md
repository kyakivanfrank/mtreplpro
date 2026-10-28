# CLAUDE.md — MT5-Style Trading PWA Design System

> Reference doc for building an iPhone-native-feeling trading PWA (MT5-inspired UI/UX).
> Note: This is an *inspired-by* design system using open, license-free assets and standard
> iOS conventions — not extracted MetaQuotes IP. Don't reuse MetaTrader's logo, wordmark,
> or app icon; everything below is either a public iOS standard or an open-source asset.

---

## 1. Typography

MT5's iOS app rides entirely on the system font, which is what makes it feel "native."
Don't import a custom font family for UI text — use the system stack.

```css
font-family: -apple-system, "SF Pro Text", "SF Pro Display", system-ui,
  "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
```

- **SF Pro Display** — used ≥20px (headlines, big price numbers, balances)
- **SF Pro Text** — used <20px (labels, body, table cells)
- **SF Mono / "SF Mono", ui-monospace** — for price ticks, P/L figures, order tickets
  (tabular-nums matter here — see below)

### Type scale (iOS HIG-aligned)

| Token | Size | Weight | Line height | Usage |
|---|---|---|---|---|
| `display-lg` | 34px | 700 | 41px | Account balance / equity hero number |
| `display` | 28px | 700 | 34px | Symbol price (big ticker) |
| `title1` | 22px | 700 | 28px | Screen titles |
| `title2` | 20px | 600 | 25px | Section headers |
| `title3` | 17px | 600 | 22px | Card titles |
| `body` | 17px | 400 | 22px | Default body / list rows |
| `callout` | 16px | 400 | 21px | Secondary row text |
| `subhead` | 15px | 400 | 20px | Row subtitles, timestamps |
| `footnote` | 13px | 400 | 18px | Fine print, disclaimers |
| `caption1` | 12px | 500 | 16px | Table headers, tags |
| `caption2` | 11px | 500 | 13px | Tab bar labels, badges |

**Critical detail MT5 gets right:** all numeric columns (price, volume, P/L, bid/ask) must
use `font-variant-numeric: tabular-nums;` so digits don't jitter/reflow on price ticks.

```css
.price, .pnl, .volume { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
```

---

## 2. Color System

Trading apps live in dark mode by default. Build dark-first, light as secondary.

### 2.1 Base surfaces (dark theme)

| Token | Hex | Usage |
|---|---|---|
| `bg-base` | `#0B0E14` | App background (near-black, slight blue cast — not pure #000) |
| `bg-elevated-1` | `#12161F` | Cards, list rows |
| `bg-elevated-2` | `#1A1F2B` | Modals, sheets, order tickets |
| `bg-elevated-3` | `#232936` | Pressed/active state surfaces |
| `border-subtle` | `#242A38` | Hairline dividers |
| `border-strong` | `#323A4A` | Input borders |

### 2.2 Text

| Token | Hex | Usage |
|---|---|---|
| `text-primary` | `#F5F7FA` | Primary labels |
| `text-secondary` | `#9AA3B2` | Secondary labels |
| `text-tertiary` | `#5C6577` | Disabled / placeholder |
| `text-inverse` | `#0B0E14` | On light/accent buttons |

### 2.3 Semantic trading colors (the part that matters most)

Buy/sell (long/short) colors are the backbone of the whole UI — chart candles, P/L,
buttons, badges all key off these two:

| Token | Hex | Usage |
|---|---|---|
| `buy` / `bull` / `long` | `#26A69A` (teal-green) or `#00C896` | Buy button, up-candles, positive P/L |
| `sell` / `bear` / `short` | `#EF5350` (coral-red) | Sell button, down-candles, negative P/L |
| `buy-bg` | `rgba(38,166,154,0.12)` | Subtle background chip for buy rows |
| `sell-bg` | `rgba(239,83,80,0.12)` | Subtle background chip for sell rows |

> Use the TradingView/MT5-convention teal+coral pair rather than pure green/red — it's
> more legible on dark backgrounds and is colorblind-friendlier. Never rely on color
> alone: pair with ▲/▼ glyphs or +/− signs.

### 2.4 Status colors (info / success / warning / danger)

Since your Flutter RentFlip project already uses `dangerBg` as the saturation/contrast
benchmark — apply the same discipline here for consistency across your products:

| Token | FG | BG |
|---|---|---|
| `success` | `#30D158` | `rgba(48,209,88,0.14)` |
| `warning` | `#FFB020` (amber, matches your RentFlip warning shift) | `rgba(255,176,32,0.14)` |
| `danger` | `#FF453A` | `rgba(255,69,58,0.14)` |
| `info` | `#0A84FF` | `rgba(10,132,255,0.14)` |

### 2.5 Accent / brand

| Token | Hex | Usage |
|---|---|---|
| `accent` | `#3D7BFF` or your own brand blue | Primary CTAs, active tab, links |
| `accent-pressed` | `#2E5FCC` | Pressed state |

### 2.6 Chart-specific

| Token | Hex | Usage |
|---|---|---|
| `chart-grid` | `#1A1F2B` | Gridlines |
| `chart-axis-text` | `#5C6577` | Axis labels |
| `chart-crosshair` | `#9AA3B2` | Crosshair lines |
| `chart-volume-up` | `rgba(38,166,154,0.5)` | Volume bars (up) |
| `chart-volume-down` | `rgba(239,83,80,0.5)` | Volume bars (down) |
| `chart-line-primary` | `#3D7BFF` | Line-chart mode |
| `chart-ma-1..4` | `#FFD60A`, `#BF5AF2`, `#64D2FF`, `#FF9F0A` | Moving average overlays |

---

## 3. Icon System

MT5's own iconography is simple line/glyph icons at 24px — you don't need their exact
files, any of these open, MIT/SIL-licensed sets nail the same feel:

| Set | Style | Best for |
|---|---|---|
| **Phosphor Icons** | Consistent line + fill duotone variants | Best overall match — has `chart-line-up`, `arrows-left-right`, `wallet` |
| **Tabler Icons** | 24px stroke-based, huge finance subset | Order/position icons, candlestick icon literally exists |
| **Lucide** | Clean, modern stroke icons (fork of Feather) | Navigation, tab bar |
| **SF Symbols** (if wrapping in a native shell later) | Apple's own, weight-matched to SF Pro | Perfect native feel if you ever go Capacitor/native |

### Icon sizing convention (iOS-native rhythm)

| Context | Size | Stroke |
|---|---|---|
| Tab bar icons | 25×25 (28×28 canvas) | 1.5–2px |
| Nav bar / toolbar icons | 22×22 | 1.5px |
| List row leading icons | 20×20 | 1.5px |
| Inline/badge icons (▲▼ trend) | 12×12 | — |
| Symbol/instrument avatars | 32×32 circle | — |
| Empty-state illustrations | 96–120px | — |

Keep one stroke weight across the whole app (1.5px @ 24px grid is the sweet spot —
matches SF Symbols' "regular" weight).

---

## 4. PWA Asset Requirements (2026 spec)

This is the exhaustive list — generate all of these from one 1024×1024 master icon
(solid background, ~10–20% safe padding, no transparency for iOS variants).

### 4.1 Favicons

| File | Size | Notes |
|---|---|---|
| `favicon.ico` | 16, 32, 48 (multi-res ico) | Legacy/tab fallback |
| `favicon.svg` | vector | Modern browsers, supports `prefers-color-scheme` |
| `favicon-16x16.png` | 16×16 | |
| `favicon-32x32.png` | 32×32 | |

### 4.2 Apple touch icon (iOS home screen)

| File | Size | Notes |
|---|---|---|
| `apple-touch-icon.png` | **180×180** | THE one size iOS actually needs in 2026 — solid bg, iOS auto-rounds corners, ~20px internal padding |
| `apple-touch-icon-152x152.png` | 152×152 | Older iPad fallback (optional) |
| `apple-touch-icon-167x167.png` | 167×167 | iPad Pro fallback (optional) |

```html
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
```

### 4.3 manifest.json / Android + Chrome install

| File | Size | purpose |
|---|---|---|
| `icon-192.png` | 192×192 | `any` |
| `icon-512.png` | 512×512 | `any` |
| `icon-maskable-192.png` | 192×192 | `maskable` — art inside center 80% safe zone (154×154) |
| `icon-maskable-512.png` | 512×512 | `maskable` — art inside center 80% safe zone (409×409) |

```json
{
  "name": "YourApp Trader",
  "short_name": "Trader",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0B0E14",
  "theme_color": "#0B0E14",
  "orientation": "portrait",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### 4.4 iOS splash screens (avoids the white-flash on launch)

iOS requires exact per-device pixel matches. Generate for at minimum current iPhone
lines (portrait; also produce landscape if you support rotation):

| Device class | CSS size | Device pixel ratio | PNG size |
|---|---|---|---|
| iPhone SE / 8 | 375×667 | 2x | 750×1334 |
| iPhone 13 mini / 12 mini | 375×812 | 3x | 1125×2436 |
| iPhone 14/15/16 std | 390×844 | 3x | 1170×2532 |
| iPhone 14/15/16 Plus | 428×926 | 3x | 1284×2778 |
| iPhone 14/15/16 Pro | 393×852 | 3x | 1179×2556 |
| iPhone 15/16 Pro Max | 430×932 | 3x | 1290×2796 |
| iPad (10.9") | 820×1180 | 2x | 1640×2360 |
| iPad Pro 11" | 834×1194 | 2x | 1668×2388 |
| iPad Pro 12.9" | 1024×1366 | 2x | 2048×2732 |

```html
<link rel="apple-touch-startup-image" href="/splash/1170x2532.png"
  media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)">
```
(Repeat per device. Splash art = your bg-base color + centered logo, no text.)

### 4.5 Social / meta

| File | Size |
|---|---|
| `og-image.png` | 1200×630 |
| `twitter-card.png` | 1200×675 |

### 4.6 Required `<head>` tags for iOS "native app" feel

```html
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Trader">
<meta name="theme-color" content="#0B0E14">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<link rel="manifest" href="/manifest.json">
```

---

## 5. Layout / Safe Area Rules

- Use `viewport-fit=cover` + `env(safe-area-inset-*)` for all fixed headers/tab bars —
  non-negotiable for notch/Dynamic Island and home-indicator clearance.
- Tab bar height: **49pt** content + `env(safe-area-inset-bottom)`.
- Nav bar height: **44pt** (compact) or **96pt** (large title, collapsing on scroll — MT5
  uses this pattern on the Quotes/Watchlist screen).
- Standard iOS margins: **16pt** horizontal screen padding, **8pt** internal card padding.
- List row height: **44pt** minimum tap target; watchlist rows typically **56–60pt** to
  fit symbol + bid/ask + chart sparkline.
- Corner radius: **12pt** cards, **10pt** buttons/inputs, **20pt** sheets/modals (iOS 16+
  continuous-corner feel — use `border-radius` + avoid clipping shadows).
- Bottom sheet order ticket: rounded top corners **20pt**, drag handle **36×5pt** pill,
  `#5C6577` at 40% opacity.

---

## 6. Core Screens Checklist (MT5 parity)

- [ ] **Quotes / Watchlist** — symbol, bid, ask, spread, mini sparkline, swipe actions (trade/chart/alert)
- [ ] **Chart** — candlestick + line toggle, timeframe pills (M1/M5/M15/H1/H4/D1/W1/MN), indicators sheet, crosshair with OHLC readout
- [ ] **Trade / Order ticket** — volume stepper, SL/TP fields, market/pending toggle, buy/sell split buttons (teal/coral)
- [ ] **Positions/Orders/History** tabs — swipe-to-close, P/L color-coded, running total header
- [ ] **Account** — equity/balance/margin/free margin/margin level grid, broker/server info
- [ ] **News** — MT5-style feed list
- [ ] **Depth of Market (DOM)** — bid/ask ladder (optional, advanced)

---

## 7. Assets To Actually Generate (action list)

1. 1024×1024 master app icon (solid `#0B0E14` bg, simple mark — no MetaQuotes marks)
2. Run master through a PWA icon generator → produces §4.1–4.3 automatically
3. Build 9 splash screens per §4.4 (or use a generator; same bg + centered logo)
4. Pull icon set: install **Phosphor** or **Tabler** via npm (`phosphor-react`,
   `@tabler/icons-react`) — don't hand-draw 40 icons
5. Candlestick chart lib: **lightweight-charts** (TradingView's open-source lib) — gives
   you MT5-grade candlestick/line/volume rendering out of the box, MIT licensed

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
