'use client';

import React from 'react';
import type { SlidingPill as SlidingPillState } from '@/components/ui/useSlidingPill';

/**
 * The travelling selection pill. Render it inside the track, before the options.
 *
 * Two nested elements on purpose: the outer owns *position* and transitions its translate, the
 * inner owns the *costume* and runs the lens keyframes. Splitting them lets a transition and an
 * animation both drive `transform` without fighting over the property.
 *
 * `lens`, when given, is a copy of the track's contents drawn in track coordinates inside the
 * pill. It counter-translates by exactly the pill's offset on the same curve, so it stays fixed
 * over the bar while the pill moves across it; the costume's scale then magnifies it about the
 * pill's centre. That is the liquid-glass lens: the bar seen through a moving drop.
 */
export default function SlidingPill({
  pill,
  settled,
  surfaceRef,
  trackWidth,
  lens,
}: Pick<SlidingPillState, 'pill' | 'settled' | 'surfaceRef' | 'trackWidth'> & { lens?: React.ReactNode }) {
  if (!pill) return null;

  return (
    <div
      aria-hidden
      className={`floating-nav-pill ${settled ? 'is-animated' : ''}`}
      style={{
        width: pill.width,
        height: pill.height,
        transform: `translate3d(${pill.x}px, ${pill.y}px, 0)`,
      }}
    >
      <span ref={surfaceRef} className="floating-nav-pill-surface">
        {lens && (
          <span className="floating-nav-lens">
            <span
              className="floating-nav-lens-track"
              style={{ width: trackWidth, transform: `translate3d(${-pill.x}px, ${-pill.y}px, 0)` }}
            >
              {lens}
            </span>
          </span>
        )}
      </span>
    </div>
  );
}
