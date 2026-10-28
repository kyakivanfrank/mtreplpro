'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  The selection pill that travels                                    */
/* ------------------------------------------------------------------ */
/**
 * One shared element that slides between the options of a segmented control, rather than a
 * background that blinks off one and on to the next.
 *
 * Mid-flight it lifts: it peels off the bar and, for the length of the trip, becomes a
 * miniature of the glass it sits in — same smoked fill, same blur, same drop shadow, hairline
 * dialled fainter — then drops that costume and settles flush into the next slot. The keyframes
 * live in `globals.css` as `nav-pill-lift`; this file owns only the geometry and the timing.
 *
 * Extracted so the bottom tab bar and the history segmented control are not two implementations
 * of the same animation. They differ in size and in what they hold; the mechanics are identical,
 * and the moment they were copied they would start drifting.
 */

export interface PillBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SlidingPill {
  /** Goes on the element the options are laid out in. Must be positioned. */
  trackRef: React.RefObject<HTMLDivElement | null>;
  /** Collect each option's node into this, by index. */
  itemRefs: React.MutableRefObject<(HTMLElement | null)[]>;
  surfaceRef: React.RefObject<HTMLSpanElement | null>;
  pill: PillBox | null;
  settled: boolean;
}

export function useSlidingPill(activeIndex: number): SlidingPill {
  const trackRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const surfaceRef = useRef<HTMLSpanElement>(null);

  const [pill, setPill] = useState<PillBox | null>(null);

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

    // The option's own box, so the pill matches whatever padding and margins it carries.
    setPill({
      x: node.offsetLeft,
      y: node.offsetTop,
      width: node.offsetWidth,
      height: node.offsetHeight,
    });
  }, [activeIndex]);

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

  // Restart the lift keyframes on every hop (re-adding a class alone won't replay it).
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !settled || activeIndex < 0) return;

    surface.classList.remove('travelling');
    void surface.offsetWidth;
    surface.classList.add('travelling');

    const done = () => surface.classList.remove('travelling');
    surface.addEventListener('animationend', done, { once: true });
    return () => surface.removeEventListener('animationend', done);
  }, [activeIndex, settled]);

  return { trackRef, itemRefs, surfaceRef, pill, settled };
}
