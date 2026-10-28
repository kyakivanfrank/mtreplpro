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
/**
 * How much of the bottom falloff is ramp rather than flat black.
 *
 * Measured down from the top of the band, and the band ends at the top of the nav — so the
 * fade is spent entirely inside the nav's own top gap and there is no darkening above it at
 * all. The list runs at full strength until it is level with the pill.
 *
 * Kept under `--nav-gap-top` (1.25rem), so the ramp is finished before it reaches the pill and
 * the black behind the pill is solid all the way to its top edge with a quarter-rem to spare.
 */
const FALLOFF_RAMP = '8rem';

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
   * Fills the header (and the sticky bar under it) with near-opaque black instead of leaving
   * it a bare filter.
   *
   * For the screens whose content is a dense column of figures — Trade and History — where
   * 1.2px of blur is not enough to tell a number under the bar from a number in it. The glass
   * controls sitting on the bar are untouched either way.
   */
  solidHeader?: boolean;
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
  headerClassName = "pt-1 pb-2 px-4",
  wrapperClassName = "",
  solidHeader = false,
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

    pane.addEventListener('touchstart', onStart, { passive: true });
    pane.addEventListener('touchmove', onMove, { passive: false });
    pane.addEventListener('touchend', onEnd);
    pane.addEventListener('touchcancel', onEnd);
    pane.addEventListener('transitionend', onSettled);

    return () => {
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
      className={`
        ${scrolls ? 'view-header absolute inset-x-0 top-0 z-30' : 'relative'}
        ${solidHeader ? 'view-header-solid' : ''}
        ${headerClassName} flex justify-between items-center
      `}
    >
      <div className="flex-1 flex justify-start z-10">{headerLeft}</div>
      <div className="absolute left-1/2 -translate-x-1/2 z-0 flex justify-center items-center">
        {headerCenter}
      </div>
      <div className="flex-1 flex justify-end z-10">{headerRight}</div>
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

      {/*
        The horizon.

        Content does not stop at the edge of the screen, it goes over it — and a list that is cut
        off by a hard line reads as ending there rather than as continuing past the frame. Two
        gradients, top and bottom, give the last tenth of the view a falloff, so a row leaving
        the screen dims on its way out instead of being guillotined.

        Layered deliberately between things. At `z-20` they are over the scrolling pane (`z-10`)
        and under the header (`z-30`), and the tab bar is `fixed z-50` outside this component
        entirely — so the two surfaces that have to stay legible are above the falloff and
        everything that scrolls is beneath it.

        The top one starts at the very top of the frame, behind the header, and that placement is
        load-bearing twice over. The header is a blur with no fill, so content passing under it
        is dimmed rather than hidden and genuinely needs the falloff. And starting it lower would
        put the gradient's darkest point exactly where Trade's sticky "Positions" bar parks —
        the one row that never scrolls, permanently under the heaviest black on the screen.
        Anchored at the top, that bar sits three-quarters of the way down the ramp instead,
        where the gradient has almost run out.

        Only on scrolling views. The chart owns its whole area and nothing in it leaves the top
        or bottom edge; a permanent gradient over a canvas is a dirty screen, not an affordance.
      */}
      {scrolls && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 z-20"
            style={{
              height: '14px',
              background: 'linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0) 100%)',
            }}
          />
          {/*
            The bottom falloff.

            Two things it has to do, and they pull in opposite directions.

            Behind the nav it has to be *finished* — plain opaque black, no residue. Anything
            short of that leaves rows faintly legible in the margins around the pill and under
            it, which is the one place they must not be: the pill is a floating object, and
            seeing the list through the gap beside it is what stops it reading as floating.
            So the bottom `RAMP_PX` worth of the band is `#000` flat, not a gradient at all.

            But it must not reach any higher than the nav does. The band is exactly
            `--nav-total-height` — the nav's own footprint and nothing more — so the whole fade
            happens inside the gap above the pill and the list is at full strength a centimetre
            further up. A falloff that climbs the screen dims rows that are nowhere near the
            nav, which is the thing that made it read as a bar in the first place.

            That leaves the ramp short, and a short ramp is exactly where a linear one betrays
            itself: alpha is perceived closer to a square-law, so a straight line from black to
            nothing bunches its visible change into the last stretch and leaves a findable line
            where it starts. The stops below are an ease-out — most of the alpha is spent early,
            so the top of the band is already nearly gone by the time it formally ends.

            Sized off the nav's own measurement rather than a percentage of the viewport. The
            thing being covered is the nav, and `10%` is a different size relative to it on
            every phone.
          */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 z-20"
            style={{
              height: 'var(--nav-total-height)',
              background: `linear-gradient(to top,
                #000 0%,
                #000 calc(100% - ${FALLOFF_RAMP}),
                rgba(0,0,0,0.94) calc(100% - ${FALLOFF_RAMP} * 0.78),
                rgba(0,0,0,0.80) calc(100% - ${FALLOFF_RAMP} * 0.56),
                rgba(0,0,0,0.56) calc(100% - ${FALLOFF_RAMP} * 0.36),
                rgba(0,0,0,0.26) calc(100% - ${FALLOFF_RAMP} * 0.18),
                rgba(0,0,0,0) 100%)`,
            }}
          />
        </>
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
