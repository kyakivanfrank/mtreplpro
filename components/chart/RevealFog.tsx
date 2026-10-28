'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ChartCoords } from '@/components/chart/chartCoords';
import { stampMinute } from '@/lib/timeFormat';

/* ------------------------------------------------------------------ */
/*  The replay seeker                                                  */
/* ------------------------------------------------------------------ */
/**
 * The playhead, dragged along the candles to choose where the session resumes from.
 *
 * This used to draw a blurred veil over the unplayed stretch. It no longer draws anything over
 * the chart at all: the future is now dimmed at the source, by giving those bars reduced-opacity
 * colours in the series itself. A veil had to dim the gridlines and the background in order to
 * reach the candles; dimming the candles reaches only the candles. What is left here is the
 * line, its readout, and the gesture.
 *
 * ── It is a tool, not an effect ──────────────────────────────────────
 *
 * Nothing in this component transitions, fades, glows or bounces, and that is a rule rather than
 * an oversight. The only thing that moves is the line, because a finger is moving it — any other
 * motion competes with the one signal the user is reading. A plain hairline in a neutral colour
 * so it stays visible over both the played bars and the dimmed ones, and a static box of text
 * beside it. If a CSS transition ever appears in this file, it is a mistake.
 *
 * ── The gesture ──────────────────────────────────────────────────────
 *
 * A plain drag anywhere on the chart grabs the playhead; there is no long-press to wait out and
 * no handle to find. The chart underneath pans on the same gesture, which is normally the reason
 * for a delay, but this surface only exists while the window is deliberately being set — a
 * finger on the chart in that mode is scrubbing, not panning. Travel is covered by the edges
 * instead: hold the drag near either side and the time scale scrolls under it.
 *
 * The boundary moves live, on every frame. The *clock* does not — it is written once, on
 * release. That split costs nothing in responsiveness, because what the user is watching is the
 * boundary; it is what keeps a seek backwards, which can clear the trading book, from firing
 * sixty times on the way to the moment they actually wanted.
 */

/** How far a finger may wander before a press counts as a drag. */
const GRAB_SLOP_PX = 4;

/** How close to the edge the finger must be for the chart to start scrolling under it. */
const EDGE_PX = 40;

/** Bars scrolled per frame while parked at an edge. */
const PAN_BARS_PER_FRAME = 0.6;

/** Neutral, so it reads against both the played bars and the dimmed ones. */
const LINE_COLOR = 'rgba(235, 235, 245, 0.8)';

interface RevealFogProps {
  coords: ChartCoords;
  /** Unix ms of the seeker — the boundary between played and not. */
  atMs: number;
  /** The window the seeker may be dragged within, unix ms. Hard stops, no bounce. */
  minMs: number;
  maxMs: number;
  /** The candle the seeker is parked on, for the readout. */
  bar: { open: number; high: number; low: number; close: number } | null;
  digits: number;
  /** Bumped by the chart whenever it pans, zooms or receives new bars. */
  revision: number;
  /** Live, on every move: moves the boundary only. */
  onScrub: (ms: number) => void;
  /** On release: the seek that actually moves the clock. */
  onCommit: (ms: number) => void;
  /** Scroll the time scale by this many bars, for scrubbing past the visible range. */
  onPan: (bars: number) => void;
}

export default function RevealFog({
  coords,
  atMs,
  minMs,
  maxMs,
  bar,
  digits,
  revision,
  onScrub,
  onCommit,
  onPan,
}: RevealFogProps) {
  const layerRef = useRef<HTMLDivElement>(null);

  /** Chart width, so the readout can flip sides rather than run off the edge. */
  const [layerWidth, setLayerWidth] = useState(0);

  /**
   * The drag, in refs rather than state.
   *
   * It arms from inside a `pointermove`, and state set there is not visible to the very next
   * move event — those arrive faster than React re-renders and re-subscribes. Nothing here is
   * rendered from, so nothing needs to be state.
   */
  const draggingRef = useRef(false);
  const press = useRef<{ x: number } | null>(null);
  /** Last scrubbed moment, so release can commit it without re-deriving from the pointer. */
  const latest = useRef(atMs);
  /** Where the finger is, so the edge-scroll loop can keep reading under it. */
  const pointerX = useRef(0);
  const panFrame = useRef(0);

  // `revision` is what re-runs this after a pan or zoom.
  void revision;

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || typeof ResizeObserver === 'undefined') return;

    const measure = () => setLayerWidth(layer.clientWidth);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(layer);
    return () => observer.disconnect();
  }, []);

  const timeUnder = useCallback(
    (clientX: number): number | null => {
      const layer = layerRef.current;
      if (!layer) return null;

      const seconds = coords.xToTime(clientX - layer.getBoundingClientRect().left);
      if (seconds === null) return null;

      // Hard clamp to the window. The archive is drawn past the end of the tape, and a seeker
      // dropped out there would ask the session to play a moment it has no bars for.
      return Math.min(maxMs, Math.max(minMs, seconds * 1000));
    },
    [coords, minMs, maxMs]
  );

  useEffect(() => {
    const scrubTo = (clientX: number) => {
      const ms = timeUnder(clientX);
      if (ms === null) return;

      latest.current = ms;
      onScrub(ms);
    };

    /**
     * Held at an edge: scroll the chart, then re-read what is now under the stationary finger.
     *
     * Both halves are needed. Scrolling alone would slide the candles past a playhead that never
     * moves; re-reading alone cannot reach a bar that is off-screen.
     */
    const step = () => {
      panFrame.current = requestAnimationFrame(step);

      const layer = layerRef.current;
      if (!draggingRef.current || !layer) return;

      const rect = layer.getBoundingClientRect();
      const direction =
        pointerX.current - rect.left < EDGE_PX
          ? -1
          : rect.right - pointerX.current < EDGE_PX
            ? 1
            : 0;

      if (direction === 0) return;

      onPan(direction * PAN_BARS_PER_FRAME);
      scrubTo(pointerX.current);
    };

    const onMove = (event: PointerEvent) => {
      pointerX.current = event.clientX;

      if (!draggingRef.current) {
        const held = press.current;
        if (!held) return;
        if (Math.abs(event.clientX - held.x) <= GRAB_SLOP_PX) return;

        draggingRef.current = true;
        panFrame.current = requestAnimationFrame(step);
      }

      event.preventDefault();
      scrubTo(event.clientX);
    };

    const onUp = () => {
      const wasDragging = draggingRef.current;

      press.current = null;
      draggingRef.current = false;
      cancelAnimationFrame(panFrame.current);

      // A tap that never moved is not a seek — and a seek backwards can clear the book, so it is
      // the last thing that should fire on an accidental touch.
      if (wasDragging) onCommit(latest.current);
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      cancelAnimationFrame(panFrame.current);
    };
  }, [timeUnder, onScrub, onCommit, onPan]);

  const x = coords.timeToX(Math.floor(atMs / 1000));
  if (x === null) return null;

  const left = Math.max(0, x);

  /** Roughly what the readout needs; past this the seeker is close enough to the edge to flip. */
  const flipped = layerWidth > 0 && left > layerWidth - 190;

  const price = (value: number) => value.toFixed(digits);

  return (
    <div ref={layerRef} className="absolute inset-0 z-[15] overflow-hidden">
      {/* The playhead. One pixel, no shadow, no glow — it marks a position, it is not a feature. */}
      <div className="absolute top-0 bottom-0 w-px" style={{ left, backgroundColor: LINE_COLOR }} />

      {/* The readout. Static box; the text changes, the box only moves with the line. */}
      <div
        className="absolute top-2 rounded border border-white/10 bg-surface px-2 py-1 text-[10px] leading-[14px] text-white tabular-nums whitespace-nowrap"
        style={{
          left: flipped ? left - 5 : left + 5,
          transform: flipped ? 'translateX(-100%)' : undefined,
        }}
      >
        <div className="font-semibold">{stampMinute(atMs)}</div>
        {bar && (
          <div className="text-muted">
            {`O ${price(bar.open)}  H ${price(bar.high)}  L ${price(bar.low)}  C ${price(bar.close)}`}
          </div>
        )}
      </div>

      {/*
        The scrub surface: the whole chart, per the spec — the line is grabbed wherever the finger
        lands, not only on a handle. It is mounted only while the window is being set, so outside
        that mode the chart pans and zooms exactly as it always did.
      */}
      <div
        onPointerDown={(event) => {
          press.current = { x: event.clientX };
          pointerX.current = event.clientX;
          latest.current = atMs;
        }}
        className="absolute inset-0 cursor-ew-resize"
        style={{ touchAction: 'none' }}
      />
    </div>
  );
}
