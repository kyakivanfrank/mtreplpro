import React, { useRef } from 'react';

/** Height of the ••• chip itself — a tap target, unrelated to how tall the time row is. */
const DOTS_HEIGHT = 28;

/** How long the ••• must be held before the window panel opens. */
const HOLD_MS = 400;

/**
 * The ••• chip, and the last inch of the time axis's top rule.
 *
 * lightweight-charts fills its corner stub's border as a `borderSize × borderSize` rect — one
 * pixel, not a line across the stub's width (see `PriceAxisStub._drawBorder` in the dist) — so
 * the rule separating the candles from the time row stops dead at the price column. The hairline
 * below is that rule carried out to the right edge: same colour, same one pixel.
 *
 * Holding the chip opens the window panel. It replaced a triple tap, which was a private
 * handshake nobody would discover and which a slow finger failed anyway; a press is the ordinary
 * phone gesture for "more about this control" and cannot be triggered by an accidental tap.
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
        aria-hidden
        className="absolute right-0 z-20 pointer-events-none bg-[#2b2f3a]"
        style={{ bottom: corner.height - 1, width: Math.max(0, corner.width - 1), height: 1 }}
      />

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
          className="text-[14px] tracking-[0.2em] font-semibold text-muted hover:text-white transition-colors"
        >
          •••
        </button>
      </div>
    </>
  );
}
