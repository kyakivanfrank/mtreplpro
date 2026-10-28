'use client';

import React, { useEffect, useState } from 'react';
import { IN_EASE, IN_MS, OUT_EASE, OUT_MS } from '@/components/ui/CenterDialog';
import Portal from '@/components/ui/Portal';

/* ------------------------------------------------------------------ */
/*  Bottom action sheet                                                */
/* ------------------------------------------------------------------ */
/**
 * A stack of choices that rises from the bottom edge, iOS-style.
 *
 * The other half of a pair. `CenterDialog` stops the screen to ask a question whose answer is a
 * decision — it arrives from nowhere, in the middle, because it is not part of anything you were
 * looking at. This is the opposite claim: it slides up from the edge and says *here is more of
 * the thing you just touched*. Which is exactly right for a position you have tapped — the row
 * is still there behind it, still showing its prices, and the sheet is the list of things you
 * can now do to it.
 *
 * ── Coming and going ─────────────────────────────────────────────────
 *
 * Straight up from below and straight back down. No overshoot, no scale: a sheet is attached to
 * the edge it came from, and a panel that bounces reads as detached from it. The timings are
 * `CenterDialog`'s, imported rather than copied — two surfaces that interrupt the screen at
 * visibly different speeds read as two different apps.
 *
 * ── Why the scrim is the only way out ────────────────────────────────
 *
 * No Cancel row. Every action here either does something or dismisses, and a sheet whose last
 * row is "not that then" spends its most reachable position — the one nearest the thumb — on
 * the one choice the whole rest of the screen already offers. Tapping away is the cancel.
 *
 * Portalled, so its `z-index` is measured against the app rather than against the pane it is
 * written in — see components/Portal.tsx, where that trap is explained once for all six
 * overlays that were caught by it.
 */

type Phase = 'hidden' | 'enter' | 'shown' | 'leave';

const FROM = 'translate3d(0, 100%, 0)';
const REST = 'translate3d(0, 0, 0)';

export interface SheetAction {
  label: string;
  /**
   * Red rather than blue: this one takes something away and cannot be undone.
   *
   * At most one per sheet, and first, which is where iOS puts it — furthest from the thumb.
   * A destructive action nearest the edge is one mis-aimed tap from a closed position.
   */
  destructive?: boolean;
  /**
   * Omit for a row that presses but does nothing.
   *
   * A supported state, not an unfinished one: the sheet's shape is part of the design and a row
   * can be present before it has anywhere to go. It still takes the press highlight, so it
   * reads as pressed rather than as broken.
   */
  onClick?: () => void;
  /** Whether choosing this dismisses the sheet. Off by default — an inert row should not. */
  closes?: boolean;
}

interface ActionSheetProps {
  open: boolean;
  onClose: () => void;
  actions: SheetAction[];
  /**
   * A panel of its own above the actions — what the sheet is *about*.
   *
   * Separate card, not a heading inside the first one. The two say different kinds of thing:
   * this one is the subject, sitting still and being read, and the group below is a set of
   * buttons. A gap between them is what stops the top of the list reading as one more fact
   * about the position, and it is why the whole arrangement is two rounded panels rather than
   * one with a divider across it.
   */
  header?: React.ReactNode;
  /** Announced to a screen reader, which has no edge to read the sheet's purpose from. */
  label?: string;
  zIndex?: number;
}

export default function ActionSheet({
  open,
  onClose,
  actions,
  header,
  label = 'Actions',
  zIndex = 80,
}: ActionSheetProps) {
  /**
   * Three visible states, not two — `open` alone cannot drive this.
   *
   * Closing has to outlive the prop: the sheet must stay mounted long enough to slide back down.
   * Mirrors `CenterDialog`'s phase machine for the same reason and with the same two-frame
   * commit, because a single frame can be coalesced with the mount paint and skip the
   * transition entirely — the sheet would simply appear, already up.
   */
  const [phase, setPhase] = useState<Phase>(open ? 'shown' : 'hidden');

  useEffect(() => {
    if (open) {
      setPhase('enter');

      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setPhase('shown'));
      });

      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }

    // Never animate out of a sheet that was never in.
    setPhase((current) => (current === 'hidden' ? 'hidden' : 'leave'));

    const done = setTimeout(() => setPhase('hidden'), OUT_MS);
    return () => clearTimeout(done);
  }, [open]);

  if (phase === 'hidden') return null;

  const leaving = phase === 'leave';
  const visible = phase === 'shown';

  const choose = (action: SheetAction) => {
    action.onClick?.();
    if (action.closes) onClose();
  };

  return (
    <Portal>
    <div
      className={`fixed inset-0 flex flex-col justify-end ${leaving ? 'pointer-events-none' : ''}`}
      style={{ zIndex }}
      onPointerDown={onClose}
    >
      {/* One layer for the darkening and the blur, so a single opacity fades both. */}
      <div
        className="absolute  inset-0"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.1)',
          WebkitBackdropFilter: 'blur(0.2px)',
          backdropFilter: 'blur(0.2px)',
          opacity: visible ? 1 : 0,
          transition: visible
            ? `opacity ${IN_MS}ms ease-out`
            : leaving
              ? `opacity ${OUT_MS}ms ease-in`
              : 'none',
        }}
      />

      {/*
        The invisible container.

        Two panels with a gap, and one transform on the box holding them, so they rise and fall
        as a single object with a seam in it rather than as two sheets that happen to be
        animating at the same time. Transforming them separately is how a gap ends up breathing
        mid-flight — a couple of pixels of drift is all it takes for the pair to stop reading as
        one thing.

        Inset from the edges rather than full-bleed, because two panels can only read as
        separate if the separation goes all the way round. A gap between two edge-to-edge slabs
        is a stripe across the screen, not a space between cards.
      */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        // Tapping inside must not reach the dismissing scrim underneath.
        onPointerDown={(event) => event.stopPropagation()}
        style={{
          transform: visible ? REST : FROM,
          transition: visible
            ? `transform ${IN_MS}ms ${IN_EASE}`
            : leaving
              ? `transform ${OUT_MS}ms ${OUT_EASE}`
              : 'none',
          // Clear of the home indicator, with the sheet's own margin under it — and then some.
          // The extra lifts the whole stack off the bottom edge so the last row is a reach
          // rather than a graze, which is what the thumb does to a control sitting on the rim.
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)',
        }}
        className="relative w-full px-2 font-sans"
      >
        {/* No rim and no rounding — see `.sheet-panel`. It is read, not pressed. */}
        {header && <div className="sheet-panel action-sheet-panel overflow-hidden mb-3">{header}</div>}

        <div className="center-dialog-panel  action-sheet-panel overflow-hidden  rounded-lg">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => choose(action)}
              className={`
             w-full py-2.5 text-center text-[18px] rounded-sm font-medium
                transition-colors duration-100 active:bg-white/10
                ${action.destructive ? 'text-danger' : 'text-accent'}
              `}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
    </Portal>
  );
}
