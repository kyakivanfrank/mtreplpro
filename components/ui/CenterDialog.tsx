'use client';

import React, { useEffect, useId, useState } from 'react';
import Portal from '@/components/ui/Portal';

/* ------------------------------------------------------------------ */
/*  Centred dialog                                                     */
/* ------------------------------------------------------------------ */
/**
 * A box in the middle of the screen: title, a line of explanation, a stack of pills.
 *
 * A centred dialog rather than a bottom sheet, which is what the rest of the app uses. A sheet
 * slides up from the edge and reads as "here is more of this screen"; this stops everything and
 * asks a question, which is the right shape when the answer is a decision rather than a value.
 *
 * ── Coming and going ─────────────────────────────────────────────────
 *
 * In, it drops a short distance from above and scales up into place. Out, it does not reverse
 * that — it shrinks and falls, continuing in the direction it came from rather than retracing
 * its path. Asymmetry is what separates the two readings: a dialog that rewinds looks undone,
 * one that keeps going looks dismissed.
 *
 * Out is also faster than in. Arriving is worth watching because there is something new to
 * read; leaving is not, and a slow exit is just latency between the tap and the screen behind.
 *
 * Portalled, like every other overlay here — see components/Portal.tsx. Without it the scrim
 * cannot dim the tab bar or the header, because both sit outside the pane this is written in
 * and no `z-index` from inside that pane can reach them.
 */

/**
 * Entering: the drop and the settle. Ends above 1, so it overshoots a touch and lands.
 *
 * Exported because the bottom sheet arrives and leaves on the same clock. Two surfaces that
 * interrupt the screen at visibly different speeds read as two different apps, and a duplicated
 * `220` in another file is a number that drifts the first time either is tuned.
 */
export const IN_MS = 220;
export const IN_EASE = 'cubic-bezier(0.2, 0.9, 0.3, 1.15)';

/** Leaving: accelerating away, no overshoot to settle into. */
export const OUT_MS = 150;
export const OUT_EASE = 'cubic-bezier(0.4, 0, 1, 1)';

/** Where it starts, and where it goes. Not mirrors of each other — see above. */
const FROM = 'translate3d(0, -22px, 0) scale(0.92)';
const REST = 'translate3d(0, 0, 0) scale(1)';
const TO = 'translate3d(0, 18px, 0) scale(0.90)';

export interface DialogAction {
  label: string;
  /**
   * Omit for a pill that presses but does nothing.
   *
   * An inert action is a supported state, not an unfinished one: a button can be present
   * because the design calls for it while having nowhere to go yet. It still takes the press
   * animation, so it reads as pressed rather than as broken.
   */
  onClick?: () => void;
  /** Whether choosing this dismisses the dialog. Off by default — an inert pill should not. */
  closes?: boolean;
  /** Label colour, for the one pill the terminal sets apart (the chart menu's red "Trade"). */
  color?: string;
}

/** iOS `body` and `subhead`, straight off the type scale — see CLAUDE.md §1. */
const DESCRIPTION_SIZE = {
  body: 'text-[17px] leading-[24px]',
  subhead: 'text-[15px] leading-[20px]',
} as const;

interface CenterDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The line under the title. Omit for a dialog that is all buttons. */
  description?: React.ReactNode;
  /**
   * Which step of the type scale the description sits on.
   *
   * `body` is the default because a dialog's second line is usually the thing it is asking
   * about — the rewind warning naming how many trades are about to be destroyed has to be read
   * at the same weight as the title. `subhead` is for the other kind: copy that explains what
   * the buttons underneath will do, which the buttons themselves already say. Sizing that as
   * body makes a dialog look like it is arguing when it is only labelling.
   */
  descriptionSize?: 'body' | 'subhead';
  /** Anything between the copy and the pills. */
  children?: React.ReactNode;
  actions?: DialogAction[];
  /** Text of the dismissing pill, or null to leave it out. */
  cancelLabel?: string | null;
  /**
   * Copy alignment.
   *
   * Left by default, which is right when there is a paragraph to read — ragged-right text is
   * easier to scan and the eye knows where each line starts. A dialog that is a bare title over
   * a list of choices has no paragraph, and a lone left-aligned heading over centred pills looks
   * like it slipped.
   */
  align?: 'left' | 'center';
  /**
   * Stacking order. The default clears the tab bar (50), the symbol picker (60) and account
   * settings (70), and stays below the outage modal (100), which must never be covered.
   */
  zIndex?: number;
}

type Phase = 'hidden' | 'enter' | 'shown' | 'leave';

export default function CenterDialog({
  open,
  onClose,
  title,
  description,
  descriptionSize = 'body',
  children,
  actions = [],
  cancelLabel = 'Cancel',
  align = 'left',
  zIndex = 80,
}: CenterDialogProps) {
  // Unique per instance, so two dialogs mounted at once cannot claim the same label ids.
  const id = useId();

  /**
   * Three visible states, not two.
   *
   * `open` alone cannot drive this. Closing has to outlive the prop — the dialog must stay
   * mounted long enough to animate out — and the resting place it leaves *towards* is not the
   * one it entered *from*, so "not open" is two different transforms depending on which way
   * the gesture is going.
   */
  const [phase, setPhase] = useState<Phase>(open ? 'shown' : 'hidden');

  useEffect(() => {
    if (open) {
      setPhase('enter');

      // Two frames, not one. A single frame can be coalesced with the mount paint, which
      // applies both transforms in the same style recalculation and skips the transition
      // entirely — the dialog would simply appear.
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setPhase('shown'));
      });

      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }

    // Never animate out of a dialog that was never in: on first mount this would otherwise
    // schedule an unmount for something already hidden.
    setPhase((current) => (current === 'hidden' ? 'hidden' : 'leave'));

    const done = setTimeout(() => setPhase('hidden'), OUT_MS);
    return () => clearTimeout(done);
  }, [open]);

  if (phase === 'hidden') return null;

  const leaving = phase === 'leave';
  const visible = phase === 'shown';

  const motion = visible
    ? `transform ${IN_MS}ms ${IN_EASE}, opacity ${IN_MS}ms ease-out`
    : leaving
      ? `transform ${OUT_MS}ms ${OUT_EASE}, opacity ${OUT_MS}ms ease-in`
      : // Placing the panel at its start point — that jump must not be animated.
        'none';

  const choose = (action: DialogAction) => {
    action.onClick?.();
    if (action.closes) onClose();
  };

  return (
    <Portal>
    <div
      // No horizontal padding here on purpose. With it, the panel's 80% was 80% of *what was
      // left after the padding* — about 286px on a 390pt phone rather than 312. The width is
      // supposed to be a share of the screen, so the screen is what it has to measure against.
      className={`fixed inset-0 flex items-center justify-center ${leaving ? 'pointer-events-none' : ''}`}
      style={{ zIndex }}
      onPointerDown={onClose}
    >
      {/*
        The scrim is its own layer so one opacity fades the darkening and the blur together.
        Animating `backdrop-filter`'s radius directly would re-sample the whole screen on every
        frame; fading a finished blur is a composited property and costs nothing.
      */}
      <div
        className="center-dialog-scrim absolute inset-0"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          WebkitBackdropFilter: 'blur(1.2px)',
          backdropFilter: 'blur(1.2px)',
          opacity: visible ? 1 : 0,
          transition: visible ? `opacity ${IN_MS}ms ease-out` : leaving ? `opacity ${OUT_MS}ms ease-in` : 'none',
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-note` : undefined}
        // Tapping inside must not reach the dismissing backdrop underneath.
        onPointerDown={(event) => event.stopPropagation()}
        style={{
          transform: visible ? REST : leaving ? TO : FROM,
          opacity: visible ? 1 : 0,
          transition: motion,
        }}
        /*
         * Height comes from the content and nothing else.
         *
         * It was pinned to a share of the screen, which put every dialog wrong in one of two
         * ways. Too tall for its content and the slack collects under the last pill, so two
         * dialogs with the same padding still do not match — which is the whole bug. Too short
         * and, because these are flex children, the overflow is paid for by squashing all of
         * them: the stack silently loses height instead of the box gaining it.
         *
         * Sized to fit, both stop being possible, and every dialog is the same box with the
         * same margins around a different number of rows. `max-h` is only a ceiling for a very
         * small screen; it is not a size.
         */
        // Fill, border and shadow all live on `.center-dialog-panel` in globals.css — they are
        // one material with the backdrop filter and cannot be tuned apart from it.
        className={`
          center-dialog-panel relative
          flex w-4/5 flex-col overflow-y-auto
          rounded-[48px] p-6 font-sans text-white
          ${align === 'center' ? 'text-center' : ''}
        `}
      >
        <h2 id={`${id}-title`} className="text-[22px] font-semibold leading-[28px]">
          {title}
        </h2>

        {description && (
          <p id={`${id}-note`} className={`mt-2 ${DESCRIPTION_SIZE[descriptionSize]}`}>
            {description}
          </p>
        )}

        {children}

        <div className="flex flex-col gap-3 pt-4">
          {actions.map((action) => (
            <Choice key={action.label} onClick={() => choose(action)}>
              {action.color ? <span style={{ color: action.color }}>{action.label}</span> : action.label}
            </Choice>
          ))}
          {cancelLabel !== null && <Choice onClick={onClose}>{cancelLabel}</Choice>}
        </div>
      </div>
    </div>
    </Portal>
  );
}

/**
 * One of the pills.
 *
 * Every pill is the same, always — same fill, same weight, same press. Cancel is not demoted to
 * a text link, and nothing is greyed out either: a stack where one option is dimmer reads as a
 * malfunction more often than as a state, and an option that would act on nothing is better
 * pressed and found empty than shown broken.
 */
function Choice({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="
        w-full shrink-0 rounded-full bg-surface-2 py-[18px]
        text-[17px] font-semibold leading-none text-white
        transition-colors active:bg-surface-3
      "
    >
      {children}
    </button>
  );
}
