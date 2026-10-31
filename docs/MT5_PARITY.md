# MT5 iPhone parity — findings and implementation

Source material: `references/real meta trader 5/` (10 screenshots), `references/my meta trader 5/`
(11 screenshots), and two screen recordings in `references/videos/` (real 158 s, ours 181 s,
1170×2532 at ~36–42 fps). Measurements below were taken from those files with PIL/OpenCV
(pixel sampling and ink extents; 1 pt = image px ÷ 2.98 on a 393 pt-wide iPhone).

Rule followed throughout: copy the real app's *rules*, not one phone's pixels. Sizes that should
scale (margins, pill width) are proportions; type sizes are fixed points, as iOS's are.

---

## 1. Fonts — MT5 uses two

| Face | Where the real app uses it | Ours |
|---|---|---|
| **SF Pro** (iOS system font) | Everything that is not a terminal figure: titles, settings rows, summary rows (Balance/Equity/…), price lines `4041.291 → 4041.057`, dates, L:/H:, the change line, tab labels, chart axes | `:root` font stack, `-apple-system` first |
| **Condensed semibold** | Symbols, `sell 0.01`, P/L figures, the header total, “Positions”, big quote digits, M15, the timeframe strip, one-click prices | `.mt5-cond` = **Roboto Condensed** (self-hosted variable woff2, 42 KB), weight 470, tracking −0.012em |

How the condensed face was identified: the real glyphs (`XAUUSDm sell 0.01`, `4040.80⁵`) were
cropped at full resolution and twelve candidate condensed faces were rendered at the same cap
height. Roboto Condensed matches the letterforms (S, m, e, s, straight l, flagged 1, narrow 0);
weight 450–500 with slight negative tracking lands within ~2% of the real width and stroke weight.
Bahnschrift scored closer numerically but its DIN `l` (tailed) is visibly wrong.

Removed: the hand-squashed Outfit cut (`scaleX(0.8)`), `.symbol-condensed` (`scaleY(1.25)`), Inter,
and every `font-mono` in the quotes list. Nothing is stretched or squashed any more.

### Type sizes (cap height, pt) — real vs ours after correction

| Element | Real | Ours (px) |
|---|---|---|
| Trade/History symbol | 12.0 | 17 |
| Position P/L | 15.0 | 20 |
| Price line | 12.0 | 17 |
| Balance/Equity/Deposit rows | 11.2–11.6 | 16 |
| “Positions” heading | 10.8 | 15 |
| Header total (`22.23 USD`) | 17.0 | 23 |
| Quotes symbol | 12.5 | 18 |
| Big quote digits | 22.4 | 31 |
| Quote prefix (`4040.`) | 13.3 | 18 |
| Change line / L: H: | 9.6 | 13.5 |
| Tab label | 7.4 | 10 (SF medium) |
| Chart axis labels | 8.1 | 11 |

## 2. Bottom tab bar

Measured (393 pt phone): bar 21 pt from each side, 62 pt tall, bottom edge 23 pt above the screen
(inside the home-indicator inset), fill `#1D1D1D`, bright rim. Items on a 64.5 pt pitch with 14 pt
inner padding. **Pill 84 × 55 pt — wider than its slot**, so long labels sit inside it; held 4.7 pt
inside the bar at the ends. Fill `#0C0C0C`. Selected tab blue, all others white (the old Trade-tab
profit tint read as a second selection and was removed).

Implemented as rules: side margin `clamp(14px, 5.4vw, 26px)`, inner padding 4%, pill = 1.3× slot,
inset 4 px, bottom gap `max(12px, safe-area − 11px)`.

Animation (real, frame by frame at 42 fps): on tap the bar swells ~2%, the pill lifts into a clear
glass lens that magnifies and refracts the icons under it (blue/amber fringes), slides in ~0.1 s
with a small overshoot, and settles back to the dark capsule by ~0.35–0.42 s. Ours: the same
sequence — swell keyframe on the bar, lens keyframe on the pill, and a magnified copy of the bar
inside the lens that counter-slides so it stays registered over the real items.

## 3. Headers and fades

The dark gradients that “ate” the top of every header were removed: the 14 px black fade at the
top of every screen, the 82% black gradient behind History's buttons, and the black band behind
the tab bar (the real app lets rows show around and through the bar). Titles are centred without
a half-pixel transform so they render sharp. Settings/Trade/Quotes: plain black at rest, frosted bar
+ hairline once content scrolls under. History: blur only.

## 4. Ticks

Before: one price per symbol every 250 ms, exactly — a metronome. Now: prices change only at
*prints*, which arrive as a deterministic random process (40 ms slots; per-slot odds driven by a
wandering activity level, 0.4 → 12 prints/s). A 2-minute sample: ~3 prints/s average, gaps from
40 ms to 3.2 s, bursts and lulls. Prices remain a pure function of the clock, so replay seeks and
the autotrader's lookahead are unaffected. Each tick is stamped with its own moment (always ≤ the
clock, monotonic), so candles bucket correctly.

## 5. Chart — own canvas engine (lightweight-charts removed)

`components/chart/engine/MT5Chart.ts`. Measured from the recordings:

- **Frame**: `#313131` hairlines — top and right of the plot, and the time-axis rule across the
  full width. **No grid** (owner's decision; the real app draws a dashed grid).
- **Price column**: as wide as its widest label (~71 pt real); labels SF 11 pt `#D4D4D4`, slight
  tracking; **even division of the visible range** (MT5's labels are not round numbers), ~40 pt apart.
- **Time row**: 26 pt; labels `28 Oct 10:45` left-aligned after a short tick mark; ~90+ pt apart.
- **Bid**: dotted teal line + filled teal box. **Positions**: red/blue outlined box at the open
  price; dashed line with `SELL 0.01, +1.55 USD` always shown.
- **Crosshair** (toolbar button): dashed white lines, small blue centre cross, white price and time
  boxes, OHLC appended to the symbol line, hint “Move crosshair or tap the chart to switch to a ruler”.
- **Gestures**: one-finger pan with momentum; pinch locks to an axis once the fingers move —
  sideways zooms time (anchored at the right edge while following the newest bar, else at the
  fingers), up-down stretches the candles taller/shorter about the price between the fingers;
  drag the price column to stretch/squash the scale; double-tap it to reset; long-press it for
  *Reset vertical scale / Free chart movement*; drag the time row to zoom. Free movement is on by
  default (owner's choice) but only leaves auto fit once a drag is clearly vertical; a new
  symbol/timeframe opens fitted at 80 bars across. Panning to within 16px of the end follows the
  newest bar; panning past it (up to 80% of the plot) holds the empty space open — new bars grow
  into it instead of snapping the view back; tap the plot for the *Trade / Indicators / Objects / Settings / Cancel* menu
  (“Trade” opens the order ticket). While panning, the blue dashed end-of-data marker shows.
- Candles: teal/coral; bodies ~68% of spacing; plain high–low bars when zoomed far out.

## 6. Other screens

- **One-click bar**: at the top of the chart, under the toolbar (owner's choice; the real app docks it at the bottom), 40 pt, both buttons coloured by the last tick.
- **Quotes**: round list button left, edit + search pill right, no search bar, blue corner marker on
  the selected row.
- **Settings**: Demo corner ribbon, MT5's measured tile colours, the fake chat badge and blue round
  button removed. Tapping the account card opens the new **Accounts** page (broker tile, blue name,
  Demo pill, `balance USD, Hedge`).
- **History**: segmented control at 17 pt with a white selected label (only the pill marks it).

## 7. Not done / needs reference material

- Ruler mode (the real crosshair hint offers it); Indicators / Objects / chart Settings pages.
- The “+” on Accounts (New Account flow) — needs screenshots of the real flow.
- Order ticket, Orders/Deals tabs, symbol picker — not yet compared against the real app.
- On-device check: tests were run in headless Chromium at 393×852 (no SF Pro on Windows, no notch);
  verify on the iPhone.

## 8. Second recording pair (`references/videos/new videos/`)

- **Header blur**: every header title/button looked soft on the phone. Cause: iOS 26 draws a Liquid
  Glass blur over the top ~40pt of an installed web app, above the page — no z-index escapes it.
  Trying first: a solid black fixed band behind the status bar (`app/page.tsx`), which WebKit is
  reported to treat as an opaque edge and skip the blur. Fallback if it still blurs on device: move
  the header row down below the ramp.
- **Tab bar** sat 9pt low (12pt gap vs 21.5pt): the bottom inset can read 0 in the installed app,
  so the gap now has a 21px floor on phones ≥780pt tall.
- **One-click bar**: no colour transition (the fade left it purple during tick bursts). 40pt tall;
  prices 10% smaller than measured (owner's call); label 8.5px; volume semibold, chevrons white.
- **Trade tab**: selected + open loss → red icon and label (real behaviour); white when unselected.
- **Price lines** (`open → current`, deal dates): Helvetica Neue (`.mt5-price-line`), 17px in Trade
  and History.
- **Settings**: header min-height counts its padding so the title centres like other screens;
  two-line rows 54pt with 19pt between baselines.
- Open question: the real Trade header has no left (card) button.
- **Chart auto scale** now glides to its target (60 ms widening, 160 ms narrowing) with
  hysteresis — the target holds while prices fit with 3% to spare and it is under 1.3× the needed
  range — so ticks and panning no longer make the axis jump. New symbol/timeframe still snaps.
- **Free chart movement**: survives timeframe changes and "Reset vertical scale" (which now only
  returns to auto scale); any drag re-takes the scale; momentum carries vertically too.
