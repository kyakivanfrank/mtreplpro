import React from 'react';
import Crosshair from '@/components/icons/Crosshair';
import Functions from '@/components/icons/Functions';
import NewPositions from '@/components/icons/NewPositions';
import Positioners from '@/components/icons/Positioners';
import Shapes from '@/components/icons/Shapes';
import { TIMEFRAMES } from '@/components/chart/chartConfig';
import type { TimeframeKey } from '@/lib/market/types';

/* Four exports, not one component: `ViewLayout` takes the header slots separately. */

/** The current timeframe. Tapping it unrolls `TimeframeStrip` over the toolbar. */
export function TimeframeButton({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      aria-label="Change timeframe"
      className={`mt5-cond text-[18px] leading-none flex items-center gap-1 transition-colors ${
        open ? 'text-accent' : 'text-white'
      }`}
    >
      {label}
    </button>
  );
}

/**
 * The timeframe strip, MT5's own gesture: the list unrolls *horizontally* from the button and
 * lays over the rest of the toolbar rather than dropping a vertical menu below it. The chart is
 * the screen, so a dropdown would cover the thing you are choosing a timeframe for.
 *
 * It must be rendered through `ViewLayout`'s `headerOverlay`, not inside `headerLeft`. The
 * header's three slots are flex items carrying `z-10`, which makes each a stacking context, so a
 * strip inside the left slot is sealed under that 10 and the right slot — same level, later in
 * the DOM — paints its icons straight over it. No z-index from in there can win.
 */
export function TimeframeStrip({
  active,
  onPick,
  onDismiss,
}: {
  active: TimeframeKey;
  onPick: (tf: (typeof TIMEFRAMES)[number]) => void;
  onDismiss: () => void;
}) {
  return (
    <>
      {/* Catches the dismissing tap. Fixed and behind the strip, so anywhere on the chart closes
          it without that tap also landing on the chart underneath. */}
      <div className="fixed inset-0 z-[998]" onClick={onDismiss} aria-hidden="true" />

      <div
        role="listbox"
        aria-label="Timeframe"
        className="absolute inset-0 z-[999] flex items-center justify-between gap-0.5
                   bg-black px-4 whitespace-nowrap
                   origin-left animate-[tfbar_140ms_ease-out]"
      >
        {TIMEFRAMES.map((tf) => {
          const isActive = tf.value === active;
          return (
            <button
              key={tf.value}
              role="option"
              aria-selected={isActive}
              onClick={() => onPick(tf)}
              className={`mt5-cond px-1 text-[18px] leading-none transition-colors ${
                isActive ? 'text-accent' : 'text-white'
              }`}
            >
              {tf.label}
            </button>
          );
        })}

        {/*
          A placeholder, and honestly so. MT5 ends this row with a chart-settings menu this app
          does not have yet. Not focusable, not clickable, hidden from screen readers — the
          difference between a control that does nothing and a mark that is not a control.
        */}
        <span
          aria-hidden
          className="px-1 text-[14px] leading-none tracking-[0.2em] font-semibold
                     text-white select-none pointer-events-none"
        >
          •••
        </span>
      </div>
    </>
  );
}

/**
 * The drawing tools, and the auto-trader's badge.
 *
 * A mode that opens real positions must never be silent about it. Everything else on this screen
 * looks identical in both modes — the trades are meant to be indistinguishable — which is
 * exactly why the *mode* needs somewhere to be visible. The dot pulses while a move is open.
 */
export function ChartTools({
  autoRunning,
  autoHolding,
  crosshairOn,
  onToggleCrosshair,
}: {
  autoRunning: boolean;
  autoHolding: boolean;
  crosshairOn: boolean;
  onToggleCrosshair: () => void;
}) {
  return (
    <div className="flex items-center gap-5 text-white text-[20px]">
      <button
        onClick={onToggleCrosshair}
        aria-pressed={crosshairOn}
        aria-label="Crosshair"
        className={crosshairOn ? 'text-accent' : ''}
      >
        <Crosshair />
      </button>
      <button className="hover:text-white transition-colors"><Functions /></button>
      <button className="hover:text-white transition-colors"><Shapes /></button>

      {autoRunning && (
        <div className="flex items-center gap-1.5 rounded-full bg-success/15 px-2 py-[3px]">
          <span
            className={`h-[6px] w-[6px] rounded-full bg-success ${autoHolding ? 'animate-pulse' : ''}`}
          />
          <span className="text-success text-[11px] font-semibold tracking-wide">AUTO</span>
        </div>
      )}
    </div>
  );
}

/**
 * The order ticket and the one-click toggle.
 *
 * The ticket button is the only way into the ticket in the whole app — the buy and sell buttons
 * place market orders directly, and the level picker only reopens a ticket already being written.
 */
export function ChartActions({
  tradeBarOpen,
  onNewOrder,
  onToggleTradeBar,
}: {
  tradeBarOpen: boolean;
  onNewOrder: () => void;
  onToggleTradeBar: () => void;
}) {
  return (
    <div className="flex items-center gap-6 text-white text-[22px]">
      <button onClick={onNewOrder} aria-label="New order" className="hover:text-white transition-colors">
        <Positioners />
      </button>
      <button
        onClick={onToggleTradeBar}
        aria-pressed={tradeBarOpen}
        aria-label={tradeBarOpen ? 'Hide one-click trading' : 'Show one-click trading'}
        className={`transition-colors ${tradeBarOpen ? 'text-accent' : 'hover:text-white'}`}
      >
        <NewPositions />
      </button>
    </div>
  );
}
