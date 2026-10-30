'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------------ */
/*  The screen frame                                                   */
/* ------------------------------------------------------------------ */
/**
 * Header on top, scrolling content below, for every screen that is a list.
 *
 * The header is not part of the scroll and never has been: this is a `flex-col h-full` box
 * whose header takes its natural height and whose content pane is the only thing that
 * scrolls. Settings, History, Trade and Quotes all get that for free.
 *
 * The header does not sit *above* the content, it sits *over* it. Content runs the full height
 * of the screen and scrolls underneath, and the header carries a backdrop blur — no fill of its
 * own, just a filter — so what passes beneath it is smeared rather than hidden. That is the one
 * arrangement in which the glass in the header has something to be glass *about*: over an opaque
 * black bar, a blurred button samples nothing and is just a grey circle.
 *
 * Its height is measured rather than assumed. History's segmented control is taller than Trade's
 * row of circles, and a hard-coded inset would either clip one or leave a gap under the other.
 *
 * Chart opts out by passing an `overflow` of its own in `contentClassName` — it owns its whole
 * area and manages panning itself, so a scroll pane underneath it would fight the chart for
 * the same gesture. That single condition gates the rubber band and the overlay header too: the
 * chart neither stretches nor lets its canvas run under the toolbar.
 */

/**
 * How far the content can be dragged past the top, in px.
 *
 * A ceiling rather than a limit: the damping below approaches it and never reaches it, so the
 * pull always has somewhere left to go and never feels like it hit a wall.
 */
const PULL_CEILING_PX = 140;

/**
 * The catapult back.
 *
 * The curve ends above 1, which overshoots — the content passes its resting place by a couple
 * of pixels and settles back. That overshoot is the whole difference between "the transform
 * was removed" and "the thing was under tension and let go".
 */
const RELEASE_MS = 460;
const RELEASE_EASE = 'cubic-bezier(0.18, 0.89, 0.24, 1.12)';

/**
 * Diminishing returns on the drag.
 *
 * Asymptotic: a finger travelling 40px moves the content 31, 140px moves it 70, 400px moves it
 * 104. The resistance is what makes it read as elastic being stretched rather than as content
 * being dragged — pulling twice as hard has to buy less than twice as far, or there is no
 * elastic, just a slow scroll.
 */
function damp(distance: number): number {
  return (distance * PULL_CEILING_PX) / (distance + PULL_CEILING_PX);
}

interface ViewLayoutProps {
  children: React.ReactNode;
  headerLeft?: React.ReactNode;
  headerCenter?: React.ReactNode;
  headerRight?: React.ReactNode;
  contentClassName?: string;
  headerClassName?: string;
  wrapperClassName?: string;
  /**
   * How the header meets the content scrolling under it — the two iOS 26 scroll-edge styles.
   *
   * `hard` (Settings, Trade, Quotes): pure black at rest; once anything scrolls beneath, a
   * frosted bar with a hairline fades in. `soft` (History): no bar at all, the content dims and
   * blurs out towards the top behind floating controls. `fade` (Settings): like `hard`, but the
   * bar is black fading to see-through rather than a grey frost. `fade-light` (Quotes, Trade,
   * History): the same, thinner.
   */
  edge?: 'hard' | 'soft' | 'fade' | 'fade-light';
  /**
   * Laid over the header's three slots, inside the header itself.
   *
   * The slots are flex items carrying `z-10`, and a z-index on a flex item creates a stacking
   * context — so anything rendered *inside* `headerLeft` is sealed under that 10 no matter what
   * z-index it asks for, and the right-hand slot, being later in the DOM at the same level,
   * paints over it. That is a hard ceiling, not a tuning problem: the chart's timeframe row has
   * to cover the icons completely, and from inside a slot it cannot.
   *
   * This renders as a sibling of the slots instead, so an `absolute inset-0` child of it gets
   * the header's exact footprint and a z-index that is compared against the rest of the screen
   * rather than against the inside of one slot.
   *
   * Only meaningful on views whose header is `relative` — a scrolling view's header is itself
   * `z-30`, which caps this the same way.
   */
  headerOverlay?: React.ReactNode;
  /**
   * Painted behind the content, centred, and outside the scroll pane.
   *
   * Outside is the whole point: a watermark placed among the children would scroll with them and
   * stop being a backdrop the moment the list was long enough to move. This sits in the frame,
   * so the rows slide over it and it does not budge.
   */
  backdrop?: React.ReactNode;
}

export default function ViewLayout({
  children,
  headerLeft,
  headerCenter,
  headerRight,
  contentClassName = '',
  // Barely any vertical padding by default: the header's own controls set its height. They are
  // 52px circles and a 52px tab strip now, which is a comfortable bar on its own, so this is
  // breathing room rather than structure.
  //
  // Asymmetric on purpose. Above the controls sits the status bar and the notch inset, which is
  // already whitespace — adding a full step of padding on top of it stacked two gaps into one
  // and pushed the bar down the screen for no reason. Below there is nothing but the first row,
  // so that side keeps the full amount and is what separates the header from the list.
  //
  // The two screens that opt out do it for opposite reasons: Settings takes more, because its
  // header is a line of text with no height of its own, and Chart keeps the symmetric pair
  // because its toolbar floats over the canvas rather than over a status bar.
  // Measured off the real terminal: 44pt controls whose centre sits 22pt below the safe-area
  // top, and the bar's edge 10pt under them. The minimum counts the padding (border-box), so a
  // header with no 44pt control -- Settings -- still centres its title where the others do.
  headerClassName = "min-h-[54px] pb-[10px] px-4",
  wrapperClassName = "",
  edge = 'hard',
  headerOverlay,
  backdrop,
}: ViewLayoutProps) {
  /** Chart opts out by owning its own overflow; everything else scrolls under a fixed header. */
  const scrolls = !contentClassName.includes('overflow');

  /**
   * The scroll pane is both the thing listened to and the thing that stretches.
   *
   * The header is deliberately not in it. It is fixed, and fixed has to mean fixed — a header
   * that slides down with the content is just the whole screen moving, which reads as the page
   * coming loose rather than as content under tension. Anchoring the stretch to the header is
   * what gives the elastic something to be attached *to*: the gap that opens beneath it is the
   * stretch made visible.
   */
  const paneRef = useRef<HTMLDivElement>(null);

  /**
   * How far the content has to start down the screen to clear the header.
   *
   * Applied as padding on the scroll pane rather than as a gap above it: padding scrolls away
   * with the content, which is exactly what should happen — the first row passes under the
   * header rather than stopping short of it.
   */
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!scrolls || !header) return;

    const measure = () => setHeaderHeight(header.offsetHeight);
    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [scrolls]);

  useEffect(() => {
    const pane = paneRef.current;
    if (!scrolls || !pane) return;

    /** Where the finger started, re-anchored whenever the gesture changes character. */
    // Drives the scroll-edge material. Written to the node so a scroll never re-renders the view.
    const header = headerRef.current;
    const onScroll = () => {
      if (header) header.toggleAttribute('data-scrolled', pane.scrollTop > 0);
    };
    onScroll();

    let anchor: number | null = null;
    /** True once this gesture has been claimed as a pull rather than a scroll. */
    let pulling = false;

    /*
     * Written straight to the node rather than held in state.
     *
     * A touchmove fires around every frame, and re-rendering Settings or Quotes at that rate to
     * move a transform would drop the drag to a stutter on the exact screens this is meant to
     * feel smooth on. Nothing below the pane depends on the offset, so nothing needs to know.
     */
    const offset = (px: number) => {
      pane.style.transform = px === 0 ? '' : `translate3d(0, ${px}px, 0)`;
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      anchor = event.touches[0].clientY;
      pulling = false;
    };

    const onMove = (event: TouchEvent) => {
      if (anchor === null || event.touches.length !== 1) return;

      const y = event.touches[0].clientY;
      const travelled = y - anchor;

      if (!pulling) {
        // Anywhere but the top, or heading upward: an ordinary scroll. Re-anchoring rather
        // than bailing is what lets a user scroll down, come back to the top and *then* keep
        // pulling into the stretch in one continuous gesture.
        if (travelled <= 0 || pane.scrollTop > 0) {
          anchor = y;
          return;
        }

        pulling = true;
        pane.style.transition = 'none';
      }

      // Pulled back up past where the stretch began: hand the gesture back to the scroller
      // mid-drag, so releasing is not required to start scrolling again.
      if (travelled <= 0) {
        pulling = false;
        anchor = y;
        offset(0);
        return;
      }

      // Held open against the browser: without this the scroller treats the same drag as an
      // overscroll and runs its own bounce underneath ours.
      event.preventDefault();
      offset(damp(travelled));
    };

    const onEnd = () => {
      anchor = null;
      if (!pulling) return;

      pulling = false;
      pane.style.transition = `transform ${RELEASE_MS}ms ${RELEASE_EASE}`;
      offset(0);
    };

    const onSettled = (event: TransitionEvent) => {
      // Only the pane's own transform, never a transition bubbling up from a row inside it.
      if (event.target === pane && event.propertyName === 'transform') {
        pane.style.transition = '';
      }
    };

    pane.addEventListener('scroll', onScroll, { passive: true });
    pane.addEventListener('touchstart', onStart, { passive: true });
    pane.addEventListener('touchmove', onMove, { passive: false });
    pane.addEventListener('touchend', onEnd);
    pane.addEventListener('touchcancel', onEnd);
    pane.addEventListener('transitionend', onSettled);

    return () => {
      pane.removeEventListener('scroll', onScroll);
      pane.removeEventListener('touchstart', onStart);
      pane.removeEventListener('touchmove', onMove);
      pane.removeEventListener('touchend', onEnd);
      pane.removeEventListener('touchcancel', onEnd);
      pane.removeEventListener('transitionend', onSettled);
      pane.style.transform = '';
      pane.style.transition = '';
    };
  }, [scrolls]);

  const header = (
    <div
      ref={headerRef}
      data-edge={scrolls ? edge : undefined}
      className={`
        ${scrolls ? 'view-header absolute inset-x-0 top-0 z-30' : 'relative'}
        ${headerClassName} flex justify-between items-center
      `}
    >
      <div className="pointer-events-none flex-1 flex justify-start z-10 [&>*]:pointer-events-auto">{headerLeft}</div>
      {/*
        Centred by a full-width flex box, not by `left-1/2 -translate-x-1/2`: a -50% shift of an
        odd-width title lands it on a half pixel, and inside the header's composited layer iOS
        then renders the text visibly soft.
      */}
      <div className="pointer-events-none absolute inset-x-0 z-0 flex justify-center items-center">
        <div className="pointer-events-auto">{headerCenter}</div>
      </div>
      <div className="pointer-events-none flex-1 flex justify-end z-10 [&>*]:pointer-events-auto">{headerRight}</div>
      {headerOverlay}
    </div>
  );

  return (
    <div
      className={`relative flex flex-col h-full bg-black text-white font-sans ${wrapperClassName}`}
      /*
       * Published on the frame rather than on the pane so everything under it inherits one
       * number. A `sticky` row inside the pane needs exactly this as its `top` to park flush
       * against the header, and a second measurement of the same element is a second thing to
       * keep in sync.
       */
      style={{ '--view-header-height': `${headerHeight}px` } as React.CSSProperties}
    >
      {backdrop && (
        <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
          {backdrop}
        </div>
      )}

      {/* Header. Outside the scroll pane and outside the stretch — fixed by construction. */}
      {header}

      {/* Content */}
      <div
        ref={paneRef}
        /*
         * The height is published as a custom property as well as consumed as padding, so
         * anything inside the pane can line itself up with the header without measuring it
         * again — a `sticky` row needs exactly this number as its `top`, and a second
         * measurement of the same element is a second thing to keep in sync.
         */
        style={scrolls ? { paddingTop: headerHeight } : undefined}
        // `relative z-10` only so the backdrop above stays behind it: an absolutely positioned
        // sibling paints over an in-flow one whatever the DOM order, so the pane has to be
        // positioned too for "first in the markup" to mean "underneath".
        className={`relative z-10 flex-1 ${scrolls ? 'overflow-y-auto overscroll-y-contain' : ''} ${contentClassName}`}
      >
        {children}
        {/* Clears the floating bottom nav in scrolling views. Sized from the nav's own
            measurement (globals.css) so the two can't drift apart. */}
        {scrolls && <div className="h-[var(--nav-total-height)] shrink-0 w-full pointer-events-none" />}
      </div>
    </div>
  );
}
