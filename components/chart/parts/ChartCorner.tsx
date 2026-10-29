import React, { useRef } from 'react';

/** Height of the ••• chip itself — a tap target, unrelated to how tall the time row is. */
const DOTS_HEIGHT = 28;

/** How long the ••• must be held before the window panel opens. */
const HOLD_MS = 400;

/**
 * The ••• chip in the bottom of the price column, just above the time row. Holding it opens the
 * replay window panel; a press is the ordinary phone gesture for "more about this control" and
 * cannot be triggered by an accidental tap.
 */
export default function ChartCorner({
  corner,
  active,
  onHold,
}: {
  corner: { width: number; height: number };
  active: boolean;
  onHold: () => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const press = () => {
    timer.current = setTimeout(() => {
      timer.current = null;
      onHold();
    }, HOLD_MS);
  };

  const release = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  if (active) return null;

  return (
    <>
      <div
        className="absolute right-[0.5px] flex items-center -mb-[0.9px] justify-center z-20 bg-black"
        // Lifted clear of the time row so the time scale keeps the corner. Width is reduced by 1px
        // so its black background doesn't cover the vertical border line of the price axis.
        style={{ bottom: corner.height, width: Math.max(0, corner.width - 1), height: DOTS_HEIGHT }}
      >
        <button
          onPointerDown={press}
          onPointerUp={release}
          onPointerCancel={release}
          onPointerLeave={release}
          aria-label="Chart tools — hold for the data window"
          className="text-[14px] tracking-[0.2em] font-semibold text-white transition-colors"
        >
          •••
        </button>
      </div>
    </>
  );
}
