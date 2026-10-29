'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  The selection pill that travels                                    */
/* ------------------------------------------------------------------ */
/**
 * One shared element that slides between the options of a bar, rather than a background that
 * blinks off one and on to the next. Used by the tab bar and by History's segmented control.
 *
 * Geometry only; the costume (dark at rest, a clear lens in flight) lives in `globals.css`.
 */

export interface PillBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PillGeometry {
  /**
   * Pill width as a multiple of its option's width. The tab bar's pill is wider than its slot
   * (84pt against a 64.5pt pitch on the real terminal), which is what lets "Settings" sit inside
   * it with room to spare.
   */
  grow?: number;
  /**
   * When set, the pill fills the track's height less this inset on each side, and is kept this
   * far inside the track's ends however wide it grows.
   */
  inset?: number;
}

export interface SlidingPill {
  /** Goes on the element the options are laid out in. Must be positioned. */
  trackRef: React.RefObject<HTMLDivElement | null>;
  /** Collect each option's node into this, by index. */
  itemRefs: React.MutableRefObject<(HTMLElement | null)[]>;
  surfaceRef: React.RefObject<HTMLSpanElement | null>;
  pill: PillBox | null;
  /** The track's own width, for anything drawn in track coordinates inside the pill. */
  trackWidth: number;
  settled: boolean;
  /** Bumped on every hop, so a costume animation can be restarted. */
  hop: number;
}

export function useSlidingPill(activeIndex: number, geometry: PillGeometry = {}): SlidingPill {
  const { grow = 1, inset } = geometry;
  const trackRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const surfaceRef = useRef<HTMLSpanElement>(null);

  const [pill, setPill] = useState<PillBox | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [hop, setHop] = useState(0);

  /** Suppresses the slide on first paint so the pill doesn't fly in from the left edge. */
  const settledRef = useRef(false);
  const [settled, setSettled] = useState(false);

  const measure = useCallback(() => {
    const track = trackRef.current;
    const node = itemRefs.current[activeIndex];
    if (!track || !node) {
      setPill(null);
      return;
    }

    const tw = track.clientWidth;
    const th = track.clientHeight;
    setTrackWidth(tw);

    if (inset === undefined) {
      // The option's own box, so the pill matches whatever padding and margins it carries.
      setPill({ x: node.offsetLeft, y: node.offsetTop, width: node.offsetWidth, height: node.offsetHeight });
      return;
    }

    const width = Math.min(node.offsetWidth * grow, tw - inset * 2);
    const centre = node.offsetLeft + node.offsetWidth / 2;
    const x = Math.min(Math.max(centre - width / 2, inset), tw - inset - width);
    setPill({ x, y: inset, width, height: th - inset * 2 });
  }, [activeIndex, grow, inset]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  // Re-measure on rotation / width changes so the pill keeps hugging its option.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [measure]);

  // Turn transitions on only after the pill has been placed once.
  useEffect(() => {
    if (settledRef.current || !pill) return;
    settledRef.current = true;

    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, [pill]);

  // Restart the costume keyframes on every hop (re-adding a class alone won't replay it).
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !settled || activeIndex < 0) return;

    setHop((n) => n + 1);
    surface.classList.remove('travelling');
    void surface.offsetWidth;
    surface.classList.add('travelling');

    const done = () => surface.classList.remove('travelling');
    surface.addEventListener('animationend', done, { once: true });
    return () => surface.removeEventListener('animationend', done);
  }, [activeIndex, settled]);

  return { trackRef, itemRefs, surfaceRef, pill, trackWidth, settled, hop };
}
