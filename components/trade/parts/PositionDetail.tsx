import React from 'react';
import type { Position } from '@/lib/trading/types';
import { sideTone, resultTone } from '@/components/ui/tone';
import type { PositionView } from '@/components/trade/positionView';
import DeltaChevron from '@/components/trade/parts/DeltaChevron';

/**
 * The position in full — the sheet's upper panel. Three bands: identity, result, terms.
 *
 * No rules between them; type size and colour already separate them, and hairlines on top of
 * that turned a compact readout into a form with sections.
 */
export default function PositionDetail({
  position,
  view,
  comment,
}: {
  position: Position;
  view: PositionView;
  /** From Settings, already trimmed. Empty means the row is not rendered at all. */
  comment: string;
}) {
  const side = sideTone(position.type === 'buy');
  const tone = resultTone(view.isProfit);

  return (
    // `pb-3.5` mirrors the identity row's `pt-3.5`; without it the last line sits flush on the
    // panel's bottom edge and reads as clipped.
    <div className="flex flex-col text-left ">
      {/* Identity */}
      <div className="flex justify-between items-baseline px-2 pt-1.5">
        <div className="flex items-center gap-1.5">
          <span className="symbol-condensed font-semibold text-[16px] leading-none tracking-tight">{view.symbol}</span>
          <span className={`text-[15px] symbol-condensed font-bold leading-none ${side}`}>{position.type}</span>
          <span className={`text-[15px] symbol-condensed font-bold leading-none ${side}`}>{position.volume.toFixed(2)}</span>
        </div>
        <span className="font-inter text-muted text-[14px]">#{position.ticket}</span>
      </div>
      <div className="px-2 py-1 font-inter text-muted text-[14px]">{view.description}</div>

      {/* Result */}

      <div className="flex justify-between items-center bg-surface px-2 pt-1">
        <span className="text-[15px] tabular-nums">
          {view.openPrice} <span className="text-faint">→</span> {view.currentPrice}
        </span>

        <span className={`font-outfit font-semibold text-[23px] leading-none ${tone}`}>
          {view.profit}
        </span>
      </div>
      {/*
        The move that produced it. The sign follows the price — a winning short prints negative,
        which is the truth — while the chevron follows the colour, so glyph and tone cannot
        disagree.
      */}
      <div className={`px-2 pt-0.5 bg-surface text-[14px] tabular-nums ${tone}`}>
        Δ = {view.delta.points} ({view.delta.percent}) <DeltaChevron up={view.isProfit} />
      </div>

      {/* Terms */}
      <div className="px-2 pt-2.5 pb-0.5 font-inter text-[14px] bg-surface text-muted space-y-1">
        <div className="flex justify-between items-center">
          <span className="flex gap-6">
            <span className="w-[26px]">S/L:</span>
            <span className="tabular-nums">{view.stopLevel}</span>
          </span>
          <span className="flex gap-2">
            <span>Swap:</span>
            <span className="tabular-nums">{position.swap.toFixed(2)}</span>
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="flex gap-6">
            <span className="w-[26px]">T/P:</span>
            <span className="tabular-nums">{view.targetLevel}</span>
          </span>
          <span className="tabular-nums">{view.openStamp}</span>
        </div>

        {/*
          Absent when empty, not dashed. S/L and T/P print `-` because a missing stop is a fact
          about the trade; a missing comment is a fact about nothing. `break-words` because this
          is the only free text here and the only thing typeable wider than the sheet.
        */}
        {comment && <div className="break-words">{comment}</div>}
      </div>
    </div>
  );
}
