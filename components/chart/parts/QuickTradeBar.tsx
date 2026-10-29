import React from 'react';
import VolumeInput from '@/components/trade/VolumeInput';
import { IN_EASE, IN_MS, OUT_EASE, OUT_MS } from '@/components/ui/CenterDialog';
import { TRADE_BAR_HEIGHT } from '@/components/chart/chartConfig';
import { PROFIT_DOWN, PROFIT_UP } from '@/lib/trading/profit';

interface BigPrice {
  prefix: string;
  big: string;
  super: string;
}

/** One side of the one-click bar: its label pinned top-left, the price centred on the baseline. */
function PriceButton({
  side,
  price,
  background,
  disabled,
  onClick,
}: {
  side: 'SELL' | 'BUY';
  price: BigPrice;
  background: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      // No colour transition: ticks arrive in bursts, and a fade between red and blue left the
      // buttons sitting purple. The real bar switches outright.
      style={{ backgroundColor: background }}
      className="relative w-[30%] shrink-0 overflow-hidden text-white active:brightness-90 disabled:opacity-50"
    >
      {/* Sizes from the real bar's ink: label 5.7pt caps; the price
          then taken 10% smaller at the owner's request. */}
      <span className="absolute top-[6px] left-[7px] text-[8.5px] leading-none">{side}</span>
      <span className="mt5-cond absolute inset-x-0 bottom-[3px] flex items-baseline justify-center">
        <span className="text-[14.5px] leading-none">{price.prefix}</span>
        <span className="text-[30.5px] leading-none">{price.big}</span>
        <span className="text-[12px] leading-none self-start mt-[1px]">{price.super}</span>
      </span>
    </button>
  );
}

/**
 * The one-click trade bar, docked above the tab bar as on the terminal.
 *
 * Two transitions on two elements doing one thing: the outer box animates its *height*, so the
 * chart genuinely gives up the space rather than being covered, and the inner bar slides down out
 * of it, so the row's bottom edge stays pinned to the tab bar the whole way.
 *
 * Both buttons take the last tick's direction — red together on a down tick, blue together on an
 * up one — rather than a fixed red sell and blue buy.
 */
export default function QuickTradeBar({
  open,
  bid,
  ask,
  hasBid,
  hasAsk,
  rising,
  symbol,
  volume,
  onVolumeChange,
  onTrade,
}: {
  open: boolean;
  bid: BigPrice;
  ask: BigPrice;
  /** A side with no price yet cannot be traded, so its button is disabled rather than guessing. */
  hasBid: boolean;
  hasAsk: boolean;
  /** Whether the last tick moved up. */
  rising: boolean;
  symbol: string;
  volume: number;
  onVolumeChange: (volume: number) => void;
  onTrade: (side: 'buy' | 'sell') => void;
}) {
  const transition = `${open ? IN_MS : OUT_MS}ms ${open ? IN_EASE : OUT_EASE}`;
  const tone = rising ? PROFIT_UP : PROFIT_DOWN;

  return (
    <div
      // Rolled away, the row is out of the tab order and out of the accessibility tree, so a
      // keyboard or VoiceOver user cannot land on a buy button that is not on the screen.
      inert={!open}
      className="shrink-0 w-full overflow-hidden bg-black"
      style={{
        height: open ? TRADE_BAR_HEIGHT : 0,
        transition: `height ${transition}`,
      }}
    >
      <div
        className="flex items-stretch w-full"
        style={{
          height: TRADE_BAR_HEIGHT,
          transform: open ? 'translate3d(0, 0, 0)' : 'translate3d(0, 100%, 0)',
          transition: `transform ${transition}`,
        }}
      >
        <PriceButton side="SELL" price={bid} background={tone} disabled={!hasBid} onClick={() => onTrade('sell')} />

        <VolumeInput
          value={volume}
          onChange={onVolumeChange}
          symbol={symbol}
          className="flex-1 min-w-0 bg-black px-6 [&>button]:text-white [&>button:disabled]:opacity-100"
          inputClassName="!font-semibold !text-[15px]"
        />

        <PriceButton side="BUY" price={ask} background={tone} disabled={!hasAsk} onClick={() => onTrade('buy')} />
      </div>
    </div>
  );
}
