import React from 'react';

/** A label left, a figure right: the Trade margin block and the History statement foot. */
export default function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-white text-[16px] leading-[23px]">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
