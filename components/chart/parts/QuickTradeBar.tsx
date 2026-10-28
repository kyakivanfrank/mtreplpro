import React from 'react';
import VolumeInput from '@/components/trade/VolumeInput';
import { IN_EASE, IN_MS, OUT_EASE, OUT_MS } from '@/components/ui/CenterDialog';
import { TRADE_BAR_HEIGHT } from '@/components/chart/chartConfig';

interface BigPrice {
  prefix: string;
  big: string;
  super: string;
}

/**
 * One side of the one-click bar. The two were written out separately and differed only in
 * colour, label and which price they read.
 */
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
      className={`w-[30%] shrink-0 ${background} flex flex-col justify-center px-2 sm:px-4 relative overflow-hidden active:brightness-90 disabled:opacity-50`}
    >
      <span className="text-[10px] font-medium text-white/90 absolute top-1.5 left-2 tracking-wide">{side}</span>
      <div className="flex items-baseline justify-center mt-3 text-white">
        <span className="text-[16px] md:text-[18px] tracking-tight">{price.prefix}</span>
        <span className="text-[24px] md:text-[32px] font-medium leading-none">{price.big}</span>
        <span className="text-[12px] md:text-[14px] font-medium relative -top-[8px] md:-top-[12px]">{price.super}</span>
      </div>
    </button>
  );
}

/**
 * The one-click trade drawer, drawn out from behind the toolbar.
 *
 * Two transitions on two elements doing one thing: the outer box animates its *height*, so the
 * chart genuinely grows into the space rather than being covered, and the inner bar slides its
 * own height upward inside it, so the row's top edge stays pinned under the toolbar the whole
 * way. Height alone would squash the buttons; transform alone would leave a 48px hole.
 *
 * Timings are the action sheet's, from `CenterDialog` — this opens and closes on a tap in
 * exactly the way a sheet does.
 */
export default function QuickTradeBar({
  open,
  bid,
  ask,
  hasBid,
  hasAsk,
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
  symbol: string;
  volume: number;
  onVolumeChange: (volume: number) => void;
  onTrade: (side: 'buy' | 'sell') => void;
}) {
  const transition = `${open ? IN_MS : OUT_MS}ms ${open ? IN_EASE : OUT_EASE}`;

  return (
    <div
      // Rolled up, the row is out of the tab order and out of the accessibility tree, so a
      // keyboard or VoiceOver user cannot land on a buy button that is not on the screen.
      inert={!open}
      className="shrink-0 w-full overflow-hidden bg-black"
      style={{
        height: open ? TRADE_BAR_HEIGHT : 0,
        transition: `height ${transition}`,
      }}
    >
      {/* Trimmed from 56: the easiest height on the screen to give back to the chart, and what
          is left still clears the 44pt minimum tap target. */}
      <div
        className="flex items-stretch gap-0 px-0 h-[48px] shrink-0 border-b border-[#0a0e17]/50 w-full"
        style={{
          transform: open ? 'translate3d(0, 0, 0)' : 'translate3d(0, -100%, 0)',
          transition: `transform ${transition}`,
        }}
      >
        <PriceButton side="SELL" price={bid} background="bg-[#D15247]" disabled={!hasBid} onClick={() => onTrade('sell')} />

        <VolumeInput
          value={volume}
          onChange={onVolumeChange}
          symbol={symbol}
          /*
            The prices are the fixed pair — 30% each — and the lot takes the remaining 40%. A buy
            and a sell price are the same shape whatever the instrument, so they can be given a
            width; the lot box only holds two chevrons and a four-character field.

            `px-2` so the chevrons' negative margins cancel the padding exactly. Hairlines top and
            bottom rather than the near-black used down its sides: the box is a field in a bar of
            buttons and needs to read as recessed.
          */
          className="flex-1 min-w-0 bg-transparent px-2 z-10 border-x border-x-[#0a0e17]/50 border-y border-y-white/15"
          // The lot, in the same face and 80% condensing as the P/L figures. Only here — the
          // ticket's copy stays on the system stack; this is the one placement sitting inches
          // from the prices it sizes.
          inputClassName="font-outfit"
        />

        <PriceButton side="BUY" price={ask} background="bg-[#4786DC]" disabled={!hasAsk} onClick={() => onTrade('buy')} />
      </div>
    </div>
  );
}
