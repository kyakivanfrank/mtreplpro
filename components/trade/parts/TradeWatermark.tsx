import React from 'react';
import TrendUpIcon from '@/components/icons/TrendUp';

/**
 * The mark behind an empty Trade screen. Always rendered and faded rather than mounted, so it
 * never pops in when the last position closes; fully gone while anything is open, as on the
 * terminal.
 */
export default function TradeWatermark({ busy }: { busy: boolean }) {
  return (
    <TrendUpIcon
      className={`w-[130px] h-[130px] text-white/75 transition-opacity duration-300 ${
        busy ? 'opacity-0' : 'opacity-100'
      }`}
    />
  );
}
