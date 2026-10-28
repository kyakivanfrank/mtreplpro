'use client';

import React from 'react';
import type { SlidingPill as SlidingPillState } from '@/components/ui/useSlidingPill';

/**
 * The travelling selection pill. Render it inside the track, before the options.
 *
 * Two nested elements on purpose: the outer owns *position* and transitions its translate, the
 * inner owns the *costume* and runs the lift keyframes. Splitting them lets a transition and an
 * animation both drive `transform` without fighting over the property.
 */
export default function SlidingPill({ pill, settled, surfaceRef }: SlidingPillState) {
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
      <span ref={surfaceRef} className="floating-nav-pill-surface" />
    </div>
  );
}
