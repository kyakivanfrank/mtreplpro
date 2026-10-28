import React from 'react';

/**
 * A label left, a figure right. Trade and History each defined this privately, plus a third
 * unused copy nothing imported.
 *
 * They differ in which half is emphasised: Trade weights both, History only the value. A real
 * difference, kept as a variant rather than as two files.
 */
interface SummaryRowProps {
  label: string;
  value: string;
  /** `trade` weights label and value alike; `history` weights the value alone. */
  variant?: 'trade' | 'history';
}

export default function SummaryRow({ label, value, variant = 'history' }: SummaryRowProps) {
  const labelWeight = variant === 'trade' ? 'font-medium' : '';
  const valueWeight = variant === 'trade' ? 'font-medium' : 'font-semibold';

  return (
    <div className="flex justify-between items-center ">
      <span className={`font-inter text-white ${labelWeight} text-[15px]`}>{label}</span>
      <span className={`font-inter text-white ${valueWeight} text-[15px] tracking-wide`}>{value}</span>
    </div>
  );
}
