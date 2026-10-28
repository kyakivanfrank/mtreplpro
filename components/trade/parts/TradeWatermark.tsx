import React from 'react';
import TrendUpIcon from '@/components/icons/TrendUp';

/**
 * The mark behind an empty Trade screen. Always rendered, only dimmed — one that appeared when
 * the last position closed would read as popping in.
 *
 * It carries its own opacity rather than being dimmed by the rows on top: a short list covers
 * only part of the glyph and left a hard edge across the arrow where the panel stopped.
 */
export default function TradeWatermark({ busy }: { busy: boolean }) {
  return (
    <TrendUpIcon
      className={`w-[130px] h-[130px] transition-colors duration-300 ${
        busy ? 'text-[#808080]/5' : 'text-[#FFFFFF]/75'
      }`}
    />
  );
}
