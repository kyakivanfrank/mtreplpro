import React from 'react';
import type { SymbolState } from '@/lib/market/store';

/**
 * An empty chart is about this instrument, never about the app.
 *
 * Data arrives one symbol at a time, so gold being drawn while bitcoin is queued is ordinary.
 */
export function ChartWaiting({
  symbolState,
  displaySymbol,
}: {
  symbolState: SymbolState;
  displaySymbol: string;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center z-20 bg-black">
      <div className="flex flex-col items-center gap-2">
        <div className="w-6 h-6 border-2 border-[#4786DC] border-t-transparent rounded-full animate-spin" />
        <span className="text-muted text-[13px]">
          {symbolState === 'downloading'
            ? `Downloading ${displaySymbol} history…`
            : symbolState === 'queued'
              ? `${displaySymbol} is queued for download…`
              : 'Loading chart…'}
        </span>
      </div>
    </div>
  );
}

/**
 * Nothing held and nowhere to fetch it from.
 *
 * Two different problems, two different sentences — "no data" for both would leave the user
 * guessing whether to wait or to check their broker. Neither mentions a bridge: the terminal
 * publishes candles into a store and this app reads them from its own origin, so naming a
 * component that no longer exists sent people looking for a machine to restart.
 */
export function ChartBlocked({
  symbolState,
  displaySymbol,
  bridgeMessage,
}: {
  symbolState: SymbolState;
  displaySymbol: string;
  bridgeMessage: string | null;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 z-20 bg-black px-8 text-center">
      <span className="text-muted text-[15px]">
        {symbolState === 'no-data'
          ? `${displaySymbol} not published yet`
          : 'Market data unavailable'}
      </span>
      {/* The store's own message wins when it has one: it names the actual failure, and the
          canned line below could only contradict it. */}
      <span className="text-faint text-[12px] leading-[16px]">
        {symbolState === 'no-data'
          ? `The terminal publishes one instrument at a time. If ${displaySymbol} does not appear within a few minutes, this account may not offer it.`
          : (bridgeMessage ??
            `The market data store did not answer, and nothing is stored for ${displaySymbol} on this device yet.`)}
      </span>
    </div>
  );
}

/**
 * A quiet strip rather than a blocking overlay: the market being shut is not an error and not
 * this chart's turn to stop. The flat line underneath is real price history, the account still
 * holds its positions against that last close, and the session keeps running because something
 * else is still trading. All that was missing was the label.
 */
export function MarketClosedBadge() {
  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[16] pointer-events-none">
      <div className="flex items-center gap-1.5 rounded-full bg-[#1A1F2B]/90 px-3 py-1 backdrop-blur-sm">
        <span className="h-1.5 w-1.5 rounded-full bg-[#FFB020]" />
        <span className="text-[#9AA3B2] text-[12px] leading-[16px]">
          Market closed — holding last price
        </span>
      </div>
    </div>
  );
}

/** Order confirmations and rejections, over the chart rather than in a dialog. */
export function ChartToast({ message }: { message: string }) {
  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-16 z-50 px-3 py-1.5 rounded-full bg-surface/95 border border-white/10 text-white text-[12px] whitespace-nowrap">
      {message}
    </div>
  );
}
