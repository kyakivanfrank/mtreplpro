import type { Candle } from '@/lib/market/types';
import type { ChartCoords } from '@/components/chart/chartCoords';

/* ------------------------------------------------------------------ */
/*  The chart, drawn by hand                                           */
/* ------------------------------------------------------------------ */
/**
 * A canvas chart built to behave like the MT5 iPhone terminal's, measured off screen recordings
 * of it (docs/MT5_PARITY.md). It replaced lightweight-charts, whose axis rules, gestures and
 * frame could only ever be approximated from outside.
 *
 * Owns: the viewport (bar spacing + which bar sits at the right edge), the price scale (auto, or
 * stretched by hand), every gesture, and every pixel of candles, axes, the bid line, the price
 * boxes and the crosshair. Knows nothing about trading: positions arrive as `PriceMark`s, and the
 * DOM overlays (trade lines, level picker, replay veil) work through `coords`.
 *
 * All sizes are CSS pixels; the backing store is scaled by devicePixelRatio, so it is sharp on
 * every phone without any number here being tuned to one of them.
 */

export interface PriceMark {
  price: number;
  color: string;
  /** `fill` is the bid's box; `outline` is a position's open price. */
  style: 'fill' | 'outline';
}

export interface ChartColors {
  up: string;
  down: string;
  ghostUp: string;
  ghostDown: string;
  bid: string;
}

export interface CrosshairInfo {
  bar: Candle;
}

interface Pointer {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  at: number;
}

type Gesture =
  | { kind: 'idle' }
  | { kind: 'press'; zone: Zone }
  | { kind: 'pan'; lastX: number; lastY: number }
  | { kind: 'scale-price'; lastY: number }
  | { kind: 'scale-time'; lastX: number }
  | {
      kind: 'pinch';
      /** Undecided until the fingers have moved: then sideways zooms time, up-down stretches price. */
      axis: 'none' | 'time' | 'price';
      spanX: number;
      spanY: number;
      startSpacing: number;
      anchorIndex: number;
      anchorX: number;
      following: boolean;
      startTop: number;
      startBottom: number;
      anchorPrice: number;
      anchorY: number;
    }
  | { kind: 'crosshair' };

type Zone = 'plot' | 'price' | 'time';

/* ---- measured off the real terminal, in pt on a 393pt-wide iPhone ---- */
const FONT_SIZE = 11;
const LABEL_TRACKING = '0.35px';
const AXIS_PAD_LEFT = 8;
const AXIS_PAD_RIGHT = 10;
const TIME_AXIS_HEIGHT = 26;
/** Target gap between price labels. MT5 divides the range evenly rather than rounding. */
const PRICE_LABEL_GAP = 40;
/** Minimum gap between time labels. */
const TIME_LABEL_GAP = 92;
const BOX_HEIGHT = 14;
/** Space after the newest bar, as a share of the plot, when following the end. */
const RIGHT_SHIFT = 0.06;
/** Vertical breathing room inside the auto scale. */
const SCALE_MARGIN = 0.1;
/**
 * Auto-scale glide. The range eases towards its target (time constant in ms) instead of
 * snapping: snapping made the candles and every price label jump whenever a bar entered or left
 * the view or a tick moved the bid. Widening is quicker than narrowing so new prices are never
 * left outside the plot for long.
 */
const SCALE_EASE_GROW_MS = 60;
const SCALE_EASE_SHRINK_MS = 160;
/**
 * Hysteresis: the target holds while the visible prices still fit inside it with this share of
 * the range to spare, and it is no more than SCALE_SLACK times the range they need. Without it
 * every tick re-targeted the scale and the axis never stood still.
 */
const SCALE_EDGE = 0.03;
const SCALE_SLACK = 1.3;

const FRAME = '#313131';
const AXIS_TEXT = '#d4d4d4';
const CROSS = 'rgba(255, 255, 255, 0.85)';

const MIN_SPACING = 1;
const MAX_SPACING = 60;
/** Bars across the plot when a chart opens or is double-tapped back to the end. */
const DEFAULT_BARS = 80;
/** How far the finger spans must change before a pinch commits to an axis. */
const PINCH_LOCK = 10;
/**
 * Added to both spans when taking their ratio. Without it a pinch that started with the fingers
 * nearly in line (a few px apart on that axis) turned every pixel of movement into a huge zoom.
 */
const PINCH_SOFT = 24;
/** Panned to within this many px of the newest bar counts as back at the end (following again). */
const FOLLOW_SNAP_PX = 16;
/** Vertical travel before a free-movement drag takes the scale off auto fit. */
const VERTICAL_TAKE_PX = 24;
const TAP_MS = 300;
const LONG_PRESS_MS = 500;
const SLOP = 6;
const DOUBLE_TAP_MS = 320;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Bar counts a time label may step by — whole hours, days and so on at every timeframe. */
const LABEL_STEPS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048, 4096];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function timeLabel(time: number, daily: boolean): string {
  const d = new Date(time * 1000);
  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return daily ? `${date} ${d.getUTCFullYear()}` : `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export class MT5Chart {
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;

  private width = 0;
  private height = 0;
  private dpr = 1;
  private axisWidth = 64;

  private bars: Candle[] = [];
  private ghostAfter = Number.POSITIVE_INFINITY;
  private viewKey = '';
  private digits = 5;
  private secondsPerBar = 60;
  private colors: ChartColors;

  private spacing = 6;
  /** Fractional bar index at the plot's right edge. */
  private rightIndex = 0;
  private following = true;
  private initialised = false;

  /** null = auto scale. */
  private manualScale: { top: number; bottom: number } | null = null;
  /**
   * On from the start (owner's choice): a drag moves the chart up and down as well as sideways.
   * A new symbol or timeframe still opens fitted, because it drops the held scale.
   */
  private freeMove = true;

  private bid: number | null = null;
  private marks: PriceMark[] = [];

  private crosshairMode = false;
  private cross: { x: number; y: number } | null = null;

  private pointers = new Map<number, Pointer>();
  private gesture: Gesture = { kind: 'idle' };
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTap = { at: 0, zone: 'plot' as Zone };
  private velocity = 0;
  private lastMoveAt = 0;
  private momentumFrame = 0;

  private frame = 0;
  private lastViewport = '';

  /** Last auto/manual scale used to draw, for the coordinate conversions. */
  private scaleTop = 1;
  private scaleBottom = 0;
  /** Where the auto scale is gliding to, and whether the next draw should land there outright. */
  private scaleTarget: { top: number; bottom: number } | null = null;
  private snapScale = true;
  private lastScaleAt = 0;
  private velocityY = 0;

  onViewportChange: (() => void) | null = null;
  onCrosshair: ((info: CrosshairInfo | null) => void) | null = null;
  onTap: ((x: number, y: number) => void) | null = null;
  onPriceAxisMenu: ((x: number, y: number) => void) | null = null;
  onCrosshairModeChange: ((on: boolean) => void) | null = null;
  /** While a finger is panning: the chart end marker is drawn, as on the terminal. */
  private dragging = false;

  constructor(container: HTMLElement, colors: ChartColors, digits: number) {
    this.container = container;
    this.colors = colors;
    this.digits = digits;

    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.inset = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.touchAction = 'none';
    container.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas unavailable');
    this.ctx = ctx;

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.momentumFrame);
    this.clearLongPress();
    this.canvas.remove();
  }

  /* ================================================================ */
  /*  Inputs                                                           */
  /* ================================================================ */

  /**
   * Hand the chart its bars. `viewKey` identifies symbol+timeframe: a new key resets the view to
   * the recent end; the same key keeps the user exactly where they were looking.
   */
  setData(bars: Candle[], viewKey: string, ghostAfter: number, secondsPerBar: number): void {
    const previous = this.bars;
    const reset = viewKey !== this.viewKey || !this.initialised;
    this.secondsPerBar = secondsPerBar;
    this.ghostAfter = ghostAfter;

    if (reset) {
      this.bars = bars;
      this.viewKey = viewKey;
      this.manualScale = null;
      this.scaleTarget = null;
      this.snapScale = true;
      this.resetView();
    } else if (previous.length > 0 && bars.length > 0) {
      // Keep the same *time* under the right edge: history may have been prepended (a backfill)
      // or bars appended (the clock moving on).
      const shift = this.indexOf(bars, previous[0].time);
      this.bars = bars;
      if (this.following) {
        this.rightIndex = this.endIndex();
      } else if (shift > 0) {
        this.rightIndex += shift;
      }
      this.clampView();
    } else {
      this.bars = bars;
      if (bars.length > 0) this.resetView();
    }

    this.invalidate();
  }

  setDigits(digits: number): void {
    if (digits === this.digits) return;
    this.digits = digits;
    this.invalidate();
  }

  setBid(bid: number | null): void {
    if (bid === this.bid) return;
    this.bid = bid;
    this.invalidate();
  }

  setMarks(marks: PriceMark[]): void {
    this.marks = marks;
    this.invalidate();
  }

  setCrosshairMode(on: boolean): void {
    if (on === this.crosshairMode) return;
    this.crosshairMode = on;
    this.cross = on ? { x: this.plotWidth() * 0.5, y: this.plotHeight() * 0.5 } : null;
    this.emitCrosshair();
    this.onCrosshairModeChange?.(on);
    this.invalidate();
  }

  isCrosshairMode(): boolean {
    return this.crosshairMode;
  }

  /**
   * Back to auto scale, gliding from wherever the scale was. Free movement stays as it is (the
   * terminal lists the two separately); the next drag takes the scale back by hand.
   */
  resetVerticalScale(): void {
    this.manualScale = null;
    this.scaleTarget = null;
    this.invalidate();
  }

  setFreeMove(on: boolean): void {
    this.freeMove = on;
    if (on) this.takeScale();
    this.invalidate();
  }

  /** Freezes the scale where it is drawn, so a drag moves it rather than auto scale fighting it. */
  private takeScale(): void {
    if (!this.manualScale) this.manualScale = { top: this.scaleTop, bottom: this.scaleBottom };
  }

  isFreeMove(): boolean {
    return this.freeMove;
  }

  /** Scroll by bars, for a drag held at an edge of the replay veil. */
  panBars(count: number): void {
    this.following = false;
    this.rightIndex += count;
    this.clampView();
    this.invalidate();
  }

  /** The price column's width and the time row's height, for the ••• chip in the corner. */
  corner(): { width: number; height: number } {
    return { width: this.axisWidth, height: TIME_AXIS_HEIGHT };
  }

  readonly coords: ChartCoords = {
    timeToX: (time) => {
      if (this.bars.length === 0) return null;
      // The bar whose bucket contains `time`: the last one starting at or before it.
      const index = this.indexAtOrBefore(time);
      if (index < 0) return null;
      return this.indexToX(index);
    },
    priceToY: (price) => (this.height > 0 ? this.priceToY(price) : null),
    xToTime: (x) => {
      if (this.bars.length === 0) return null;
      const index = Math.min(this.bars.length - 1, Math.max(0, Math.round(this.xToIndex(x))));
      return this.bars[index].time;
    },
    yToPrice: (y) => (this.height > 0 ? this.yToPrice(y) : null),
  };

  /* ================================================================ */
  /*  Geometry                                                         */
  /* ================================================================ */

  private plotWidth(): number {
    return Math.max(0, this.width - this.axisWidth);
  }

  private plotHeight(): number {
    return Math.max(0, this.height - TIME_AXIS_HEIGHT);
  }

  private endIndex(): number {
    return this.bars.length - 1 + 0.5 + (this.plotWidth() * RIGHT_SHIFT) / this.spacing;
  }

  private indexToX(index: number): number {
    return this.plotWidth() - (this.rightIndex - index) * this.spacing;
  }

  private xToIndex(x: number): number {
    return this.rightIndex - (this.plotWidth() - x) / this.spacing;
  }

  private priceToY(price: number): number {
    const h = this.plotHeight();
    const range = this.scaleTop - this.scaleBottom || 1;
    return ((this.scaleTop - price) / range) * h;
  }

  private yToPrice(y: number): number {
    const h = this.plotHeight() || 1;
    return this.scaleTop - (y / h) * (this.scaleTop - this.scaleBottom);
  }

  private indexOf(bars: Candle[], time: number): number {
    let lo = 0;
    let hi = bars.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (bars[mid].time === time) return mid;
      if (bars[mid].time < time) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  private indexAtOrBefore(time: number): number {
    let lo = 0;
    let hi = this.bars.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.bars[mid].time <= time) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  private defaultSpacing(): number {
    return Math.min(MAX_SPACING, Math.max(3, this.plotWidth() / DEFAULT_BARS || 6));
  }

  private resetView(): void {
    // Opens on the recent end at a readable density.
    this.spacing = this.defaultSpacing();
    this.following = true;
    this.rightIndex = this.endIndex();
    this.initialised = this.width > 0;
  }

  private clampView(): void {
    if (this.bars.length === 0) return;
    const w = this.plotWidth();
    // Up to 80% of the plot can be empty space past the newest bar, to look ahead into.
    const max = this.bars.length - 1 + 0.5 + (w * 0.8) / this.spacing;
    const min = Math.min(max, (w * 0.2) / this.spacing);
    this.rightIndex = Math.min(max, Math.max(min, this.rightIndex));
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (rect.width === this.width && rect.height === this.height && dpr === this.dpr) return;

    const wasEmpty = this.width === 0;
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = dpr;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);

    if (wasEmpty && this.bars.length > 0) this.resetView();
    else if (this.following) this.rightIndex = this.endIndex();
    this.clampView();
    this.draw();
  }

  /* ================================================================ */
  /*  Scale                                                            */
  /* ================================================================ */

  private computeScale(): void {
    if (this.manualScale) {
      this.scaleTop = this.manualScale.top;
      this.scaleBottom = this.manualScale.bottom;
      this.scaleTarget = null;
      return;
    }

    const first = Math.max(0, Math.floor(this.xToIndex(0)));
    const last = Math.min(this.bars.length - 1, Math.ceil(this.xToIndex(this.plotWidth())));
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = first; i <= last; i += 1) {
      const bar = this.bars[i];
      if (bar.high > hi) hi = bar.high;
      if (bar.low < lo) lo = bar.low;
    }
    if (this.bid !== null && this.following) {
      hi = Math.max(hi, this.bid);
      lo = Math.min(lo, this.bid);
    }
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) {
      hi = 1;
      lo = 0;
    }
    if (hi === lo) {
      hi += 10 ** -this.digits * 10;
      lo -= 10 ** -this.digits * 10;
    }

    const margin = (hi - lo) * SCALE_MARGIN;
    const need = { top: hi + margin, bottom: lo - margin };
    const held = this.scaleTarget;
    const heldRange = held ? held.top - held.bottom : 0;
    const fits =
      held !== null &&
      hi <= held.top - heldRange * SCALE_EDGE &&
      lo >= held.bottom + heldRange * SCALE_EDGE &&
      heldRange <= (need.top - need.bottom) * SCALE_SLACK;
    const target = fits && held ? held : need;
    this.scaleTarget = target;

    const now = performance.now();
    const dt = Math.min(64, now - (this.lastScaleAt || now));
    this.lastScaleAt = now;

    if (this.snapScale || this.scaleTop <= this.scaleBottom) {
      this.snapScale = false;
      this.scaleTop = target.top;
      this.scaleBottom = target.bottom;
      return;
    }

    const growing = target.top > this.scaleTop || target.bottom < this.scaleBottom;
    const k = 1 - Math.exp(-dt / (growing ? SCALE_EASE_GROW_MS : SCALE_EASE_SHRINK_MS));
    this.scaleTop += (target.top - this.scaleTop) * k;
    this.scaleBottom += (target.bottom - this.scaleBottom) * k;

    const range = target.top - target.bottom;
    const close = range * 1e-4;
    if (Math.abs(target.top - this.scaleTop) < close && Math.abs(target.bottom - this.scaleBottom) < close) {
      this.scaleTop = target.top;
      this.scaleBottom = target.bottom;
    } else {
      // Still gliding: ask for another frame.
      this.invalidate();
    }
  }

  /* ================================================================ */
  /*  Drawing                                                          */
  /* ================================================================ */

  invalidate(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private font(): string {
    return `${FONT_SIZE}px -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  }

  private setTextStyle(ctx: CanvasRenderingContext2D): void {
    ctx.font = this.font();
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = LABEL_TRACKING;
    ctx.textBaseline = 'middle';
  }

  private draw(): void {
    const ctx = this.ctx;
    const { dpr } = this;
    if (this.width === 0 || this.height === 0) return;

    // The price column is as wide as its widest label, as on the terminal.
    this.setTextStyle(ctx);
    const sample = this.bars.length ? this.bars[this.bars.length - 1].close : 0;
    const widest = ctx.measureText(sample.toFixed(this.digits).replace(/\d/g, '8')).width;
    const nextAxis = Math.ceil(widest + AXIS_PAD_LEFT + AXIS_PAD_RIGHT);
    if (nextAxis !== this.axisWidth) {
      this.axisWidth = nextAxis;
      if (this.following) this.rightIndex = this.endIndex();
    }

    this.computeScale();

    const W = this.width;
    const H = this.height;
    const pw = this.plotWidth();
    const ph = this.plotHeight();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    /* ---- candles ---- */
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, pw, ph);
    ctx.clip();
    this.drawBars(ctx);
    ctx.restore();

    /* ---- frame: top and right of the plot, and the time axis rule across everything ---- */
    const px = 1 / dpr;
    const snap = (v: number) => Math.round(v * dpr) / dpr + px / 2;
    ctx.strokeStyle = FRAME;
    ctx.lineWidth = px;
    ctx.beginPath();
    ctx.moveTo(0, snap(0));
    ctx.lineTo(snap(pw), snap(0));
    ctx.lineTo(snap(pw), snap(ph));
    ctx.moveTo(0, snap(ph));
    ctx.lineTo(W, snap(ph));
    ctx.stroke();

    this.drawPriceAxis(ctx, pw, ph);
    this.drawTimeAxis(ctx, pw, ph, snap);
    this.drawBidAndMarks(ctx, pw, ph);
    if (this.dragging) this.drawEndMarker(ctx, pw, ph);
    if (this.cross) this.drawCrosshair(ctx, pw, ph);

    const viewport = `${this.rightIndex}|${this.spacing}|${this.scaleTop}|${this.scaleBottom}|${W}|${H}|${this.axisWidth}`;
    if (viewport !== this.lastViewport) {
      this.lastViewport = viewport;
      this.onViewportChange?.();
    }
  }

  private drawBars(ctx: CanvasRenderingContext2D): void {
    const { dpr } = this;
    const pw = this.plotWidth();
    const first = Math.max(0, Math.floor(this.xToIndex(-this.spacing)));
    const last = Math.min(this.bars.length - 1, Math.ceil(this.xToIndex(pw + this.spacing)));
    if (last < first) return;

    // Bodies a little under the spacing, wicks a device pixel. Below ~3px apart there is no room
    // for a body, and the terminal draws plain high-low bars instead.
    const bodyWidth = this.spacing >= 3 ? Math.max(1, Math.round(this.spacing * 0.68 * dpr) / dpr) : 0;
    const wick = Math.max(1 / dpr, Math.min(1, this.spacing * 0.25));
    const px = 1 / dpr;

    const groups: Record<string, { wicks: number[]; bodies: number[] }> = {};
    const push = (color: string) => (groups[color] ??= { wicks: [], bodies: [] });

    for (let i = first; i <= last; i += 1) {
      const bar = this.bars[i];
      const ghost = bar.time > this.ghostAfter;
      const up = bar.close >= bar.open;
      const color = ghost ? (up ? this.colors.ghostUp : this.colors.ghostDown) : up ? this.colors.up : this.colors.down;
      const g = push(color);

      const cx = Math.round(this.indexToX(i) * dpr) / dpr;
      const yh = this.priceToY(bar.high);
      const yl = this.priceToY(bar.low);
      g.wicks.push(cx, yh, yl);

      if (bodyWidth > 0) {
        const yo = this.priceToY(bar.open);
        const yc = this.priceToY(bar.close);
        const top = Math.min(yo, yc);
        const height = Math.max(px, Math.abs(yc - yo));
        g.bodies.push(cx - bodyWidth / 2, top, bodyWidth, height);
      }
    }

    for (const [color, g] of Object.entries(groups)) {
      ctx.fillStyle = color;
      for (let k = 0; k < g.wicks.length; k += 3) {
        ctx.fillRect(g.wicks[k] - wick / 2, g.wicks[k + 1], wick, Math.max(px, g.wicks[k + 2] - g.wicks[k + 1]));
      }
      for (let k = 0; k < g.bodies.length; k += 4) {
        ctx.fillRect(g.bodies[k], g.bodies[k + 1], g.bodies[k + 2], g.bodies[k + 3]);
      }
    }
  }

  private formatPrice(price: number): string {
    return price.toFixed(this.digits);
  }

  private drawPriceAxis(ctx: CanvasRenderingContext2D, pw: number, ph: number): void {
    this.setTextStyle(ctx);
    ctx.fillStyle = AXIS_TEXT;
    ctx.textAlign = 'left';

    // Even division of the visible range — MT5's labels are not round numbers.
    const count = Math.max(2, Math.round(ph / PRICE_LABEL_GAP));
    const step = (this.scaleTop - this.scaleBottom) / count;
    for (let k = 0; k < count; k += 1) {
      const price = this.scaleTop - step * (k + 0.25);
      const y = this.priceToY(price);
      if (y < FONT_SIZE / 2 || y > ph - FONT_SIZE / 2) continue;
      ctx.fillText(this.formatPrice(price), pw + AXIS_PAD_LEFT, y);
    }
  }

  private drawTimeAxis(ctx: CanvasRenderingContext2D, pw: number, ph: number, snap: (v: number) => number): void {
    if (this.bars.length === 0) return;
    this.setTextStyle(ctx);
    ctx.fillStyle = AXIS_TEXT;
    ctx.textAlign = 'left';

    const daily = this.secondsPerBar >= 86400;
    const every = LABEL_STEPS.find((n) => n * this.spacing >= TIME_LABEL_GAP) ?? LABEL_STEPS[LABEL_STEPS.length - 1];
    const first = Math.max(0, Math.floor(this.xToIndex(0) / every) * every);
    const last = Math.min(this.bars.length - 1, Math.ceil(this.xToIndex(this.width)));
    const y = ph + TIME_AXIS_HEIGHT / 2 + 0.5;

    ctx.strokeStyle = FRAME;
    ctx.lineWidth = 1 / this.dpr;
    ctx.beginPath();
    for (let i = first; i <= last; i += every) {
      const x = this.indexToX(i);
      if (x < 0) continue;
      ctx.moveTo(snap(x), ph);
      ctx.lineTo(snap(x), ph + 4);
      ctx.fillText(timeLabel(this.bars[i].time, daily), x + 4, y);
    }
    ctx.stroke();
  }

  private drawBox(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, fill: string | null, stroke: string | null, textColor: string): void {
    const w = this.axisWidth - 2;
    const top = Math.round(y - BOX_HEIGHT / 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(x, top, w, BOX_HEIGHT);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(x, top, w, BOX_HEIGHT);
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, top + 0.5, w - 1, BOX_HEIGHT - 1);
    }
    this.setTextStyle(ctx);
    ctx.textAlign = 'left';
    ctx.fillStyle = textColor;
    ctx.fillText(text, x + AXIS_PAD_LEFT - 2, top + BOX_HEIGHT / 2 + 0.5);
  }

  private drawBidAndMarks(ctx: CanvasRenderingContext2D, pw: number, ph: number): void {
    for (const mark of this.marks) {
      const y = this.priceToY(mark.price);
      if (y < 0 || y > ph) continue;
      this.drawBox(ctx, pw + 1, y, this.formatPrice(mark.price), mark.style === 'fill' ? mark.color : null, mark.style === 'outline' ? mark.color : null, mark.style === 'fill' ? '#000' : mark.color);
    }

    if (this.bid === null) return;
    const y = this.priceToY(this.bid);
    if (y < 0 || y > ph) return;

    // Dotted across the plot, then the filled box on the column.
    ctx.strokeStyle = this.colors.bid;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    const yy = Math.round(y) + 0.5;
    ctx.moveTo(0, yy);
    ctx.lineTo(pw, yy);
    ctx.stroke();
    ctx.setLineDash([]);
    this.drawBox(ctx, pw + 1, y, this.formatPrice(this.bid), this.colors.bid, null, '#000');
  }

  private drawEndMarker(ctx: CanvasRenderingContext2D, pw: number, ph: number): void {
    if (this.bars.length === 0) return;
    const x = Math.round(this.indexToX(this.bars.length - 1)) + 0.5;
    if (x < 0 || x > pw) return;
    ctx.strokeStyle = '#1a80e8';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ph);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#1a80e8';
    ctx.beginPath();
    ctx.moveTo(x - 6, ph);
    ctx.lineTo(x + 6, ph);
    ctx.lineTo(x, ph - 9);
    ctx.closePath();
    ctx.fill();
  }

  private drawCrosshair(ctx: CanvasRenderingContext2D, pw: number, ph: number): void {
    if (!this.cross) return;
    const index = Math.min(this.bars.length - 1, Math.max(0, Math.round(this.xToIndex(this.cross.x))));
    const x = Math.round(this.indexToX(index)) + 0.5;
    const y = Math.round(Math.min(ph, Math.max(0, this.cross.y))) + 0.5;

    ctx.strokeStyle = CROSS;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(pw, y);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ph);
    ctx.stroke();
    ctx.setLineDash([]);

    // The little blue cross where they meet.
    ctx.strokeStyle = '#0A84FF';
    ctx.beginPath();
    ctx.moveTo(x - 5, y);
    ctx.lineTo(x + 5, y);
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 5);
    ctx.stroke();

    this.drawBox(ctx, pw + 1, y, this.formatPrice(this.yToPrice(y)), '#ffffff', null, '#000');

    const bar = this.bars[index];
    if (bar) {
      this.setTextStyle(ctx);
      const text = timeLabel(bar.time, this.secondsPerBar >= 86400);
      const w = ctx.measureText(text).width + 8;
      const left = Math.min(this.width - w, Math.max(0, x - w / 2));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(left, ph + 1, w, BOX_HEIGHT);
      ctx.fillStyle = '#000';
      ctx.textAlign = 'left';
      ctx.fillText(text, left + 4, ph + 1 + BOX_HEIGHT / 2 + 0.5);
    }
  }

  private emitCrosshair(): void {
    if (!this.onCrosshair) return;
    if (!this.cross || this.bars.length === 0) {
      this.onCrosshair(null);
      return;
    }
    const index = Math.min(this.bars.length - 1, Math.max(0, Math.round(this.xToIndex(this.cross.x))));
    this.onCrosshair({ bar: this.bars[index] });
  }

  /* ================================================================ */
  /*  Gestures                                                         */
  /* ================================================================ */

  private zoneAt(x: number, y: number): Zone {
    if (y > this.plotHeight()) return 'time';
    if (x > this.plotWidth()) return 'price';
    return 'plot';
  }

  private local(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private clearLongPress(): void {
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }

  private stopMomentum(): void {
    cancelAnimationFrame(this.momentumFrame);
    this.momentumFrame = 0;
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.canvas.setPointerCapture(event.pointerId);
    this.stopMomentum();
    const { x, y } = this.local(event);
    this.pointers.set(event.pointerId, { id: event.pointerId, x, y, startX: x, startY: y, at: performance.now() });

    if (this.pointers.size === 2) {
      this.clearLongPress();
      const [a, b] = [...this.pointers.values()];
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      this.gesture = {
        kind: 'pinch',
        axis: 'none',
        spanX: Math.abs(a.x - b.x),
        spanY: Math.abs(a.y - b.y),
        startSpacing: this.spacing,
        anchorIndex: this.xToIndex(midX),
        anchorX: midX,
        following: this.following,
        startTop: this.manualScale?.top ?? this.scaleTop,
        startBottom: this.manualScale?.bottom ?? this.scaleBottom,
        anchorPrice: this.yToPrice(midY),
        anchorY: midY,
      };
      return;
    }

    if (this.pointers.size > 2) return;

    const zone = this.zoneAt(x, y);
    if (this.crosshairMode && zone === 'plot') {
      this.gesture = { kind: 'crosshair' };
      this.cross = { x, y };
      this.emitCrosshair();
      this.invalidate();
      return;
    }

    this.gesture = { kind: 'press', zone };
    this.velocity = 0;
    this.lastMoveAt = performance.now();

    if (zone === 'price') {
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = null;
        if (this.gesture.kind === 'press') {
          this.gesture = { kind: 'idle' };
          this.onPriceAxisMenu?.(x, y);
        }
      }, LONG_PRESS_MS);
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    const { x, y } = this.local(event);
    pointer.x = x;
    pointer.y = y;

    const g = this.gesture;

    if (g.kind === 'pinch') {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const spanX = Math.abs(a.x - b.x);
      const spanY = Math.abs(a.y - b.y);
      if (g.axis === 'none') {
        // Commit to one axis, so a sideways pinch never stretches the candles by accident.
        const dx = Math.abs(spanX - g.spanX);
        const dy = Math.abs(spanY - g.spanY);
        if (Math.max(dx, dy) < PINCH_LOCK) return;
        g.axis = dy > dx ? 'price' : 'time';
      }

      if (g.axis === 'price') {
        // Fingers apart = taller candles. The price between the fingers stays between them.
        const factor = Math.max(0.05, (spanY + PINCH_SOFT) / (g.spanY + PINCH_SOFT));
        const range = (g.startTop - g.startBottom) / factor;
        const top = g.anchorPrice + (g.anchorY / (this.plotHeight() || 1)) * range;
        this.manualScale = { top, bottom: top - range };
        this.invalidate();
        return;
      }

      const factor = (spanX + PINCH_SOFT) / (g.spanX + PINCH_SOFT);
      this.spacing = Math.min(MAX_SPACING, Math.max(MIN_SPACING, g.startSpacing * factor));
      if (g.following) {
        this.rightIndex = this.endIndex();
      } else {
        // The bar under the fingers stays under the fingers.
        this.rightIndex = g.anchorIndex + (this.plotWidth() - g.anchorX) / this.spacing;
        this.following = false;
      }
      this.clampView();
      this.invalidate();
      return;
    }

    if (g.kind === 'crosshair') {
      this.cross = { x: Math.min(this.plotWidth(), Math.max(0, x)), y: Math.min(this.plotHeight(), Math.max(0, y)) };
      this.emitCrosshair();
      this.invalidate();
      return;
    }

    if (g.kind === 'press') {
      if (Math.abs(x - pointer.startX) + Math.abs(y - pointer.startY) < SLOP) return;
      this.clearLongPress();
      if (g.zone === 'price') this.gesture = { kind: 'scale-price', lastY: y };
      else if (g.zone === 'time') this.gesture = { kind: 'scale-time', lastX: x };
      else {
        this.gesture = { kind: 'pan', lastX: x, lastY: y };
        this.dragging = true;
        this.velocityY = 0;
      }
      return;
    }

    if (g.kind === 'pan') {
      const dx = x - g.lastX;
      const dy = y - g.lastY;
      const now = performance.now();
      const dt = Math.max(1, now - this.lastMoveAt);
      this.velocity = 0.8 * (dx / dt) + 0.2 * this.velocity;
      this.velocityY = 0.8 * (dy / dt) + 0.2 * this.velocityY;
      this.lastMoveAt = now;
      g.lastX = x;
      g.lastY = y;
      this.panPixels(dx);
      if (this.freeMove) {
        // The scale is only taken off auto fit once the drag is clearly vertical, so a sideways
        // scroll through history keeps the candles fitted.
        const ty = Math.abs(y - pointer.startY);
        if (!this.manualScale && ty > VERTICAL_TAKE_PX && ty > Math.abs(x - pointer.startX) * 0.5) this.takeScale();
        this.panVertical(dy);
      }
      this.invalidate();
      return;
    }

    if (g.kind === 'scale-price') {
      const dy = y - g.lastY;
      g.lastY = y;
      const top = this.manualScale?.top ?? this.scaleTop;
      const bottom = this.manualScale?.bottom ?? this.scaleBottom;
      const mid = (top + bottom) / 2;
      // Down stretches the candles, up squashes them — the terminal's direction.
      const factor = Math.exp(-dy * 0.006);
      const half = ((top - bottom) / 2) * factor;
      this.manualScale = { top: mid + half, bottom: mid - half };
      this.invalidate();
      return;
    }

    if (g.kind === 'scale-time') {
      const dx = x - g.lastX;
      g.lastX = x;
      this.spacing = Math.min(MAX_SPACING, Math.max(MIN_SPACING, this.spacing * Math.exp(dx * 0.006)));
      if (this.following) this.rightIndex = this.endIndex();
      this.clampView();
      this.invalidate();
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    this.clearLongPress();
    if (!pointer) return;

    const g = this.gesture;

    if (g.kind === 'pinch') {
      // One finger left on the glass: carry on as a pan from where it is.
      if (this.pointers.size === 1) {
        const rest = [...this.pointers.values()][0];
        this.gesture = { kind: 'pan', lastX: rest.x, lastY: rest.y };
        this.dragging = true;
      } else {
        this.gesture = { kind: 'idle' };
      }
      return;
    }

    if (this.pointers.size > 0) return;

    if (g.kind === 'press' && event.type === 'pointerup' && performance.now() - pointer.at < TAP_MS) {
      const now = performance.now();
      const double = now - this.lastTap.at < DOUBLE_TAP_MS && this.lastTap.zone === g.zone;
      this.lastTap = { at: now, zone: g.zone };
      if (g.zone === 'price' && double) this.resetVerticalScale();
      else if (g.zone === 'plot') this.onTap?.(pointer.x, pointer.y);
    }

    if (g.kind === 'pan') {
      this.dragging = false;
      const fresh = performance.now() - this.lastMoveAt < 80;
      if (!this.freeMove) this.velocityY = 0;
      if (fresh && (Math.abs(this.velocity) > 0.05 || Math.abs(this.velocityY) > 0.05)) this.startMomentum();
      this.invalidate();
    }

    this.gesture = { kind: 'idle' };
  };

  private panPixels(dx: number): void {
    if (dx === 0) return;
    this.rightIndex -= dx / this.spacing;
    this.clampView();
    // Back at the end means following again. Anywhere else, including out in the empty space past
    // the newest bar, is a fixed view: the space stays open and new bars grow into it.
    this.following = Math.abs(this.rightIndex - this.endIndex()) <= Math.max(0.5, FOLLOW_SNAP_PX / this.spacing);
  }

  /** Free movement's vertical half: slides the held scale with the finger. */
  private panVertical(dy: number): void {
    if (dy === 0 || !this.manualScale) return;
    const shift = (dy / (this.plotHeight() || 1)) * (this.manualScale.top - this.manualScale.bottom);
    this.manualScale = { top: this.manualScale.top + shift, bottom: this.manualScale.bottom + shift };
  }

  private startMomentum(): void {
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      const decay = Math.pow(0.94, dt / 16);
      this.velocity *= decay;
      this.velocityY *= decay;
      if (Math.abs(this.velocity) < 0.02 && Math.abs(this.velocityY) < 0.02) {
        this.momentumFrame = 0;
        return;
      }
      this.panPixels(this.velocity * dt);
      if (this.freeMove) this.panVertical(this.velocityY * dt);
      this.draw();
      this.momentumFrame = requestAnimationFrame(step);
    };
    this.momentumFrame = requestAnimationFrame(step);
  }

  /** Trackpad and mouse wheel, for the desktop: wheel zooms, shift/horizontal wheel pans. */
  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      this.panPixels(-event.deltaX);
    } else {
      this.spacing = Math.min(MAX_SPACING, Math.max(MIN_SPACING, this.spacing * Math.exp(-event.deltaY * 0.002)));
      if (this.following) this.rightIndex = this.endIndex();
      this.clampView();
    }
    this.invalidate();
  };
}
