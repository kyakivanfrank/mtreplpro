import React from 'react';

/** The green corner ribbon on the Settings account card. The card must be `relative overflow-hidden`. */
export function DemoRibbon() {
  return (
    <div aria-label="Demo account" className="absolute top-0 right-0 w-[42px] h-[42px] pointer-events-none">
      <div
        className="absolute inset-0 bg-[#4ec80e]"
        style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%)' }}
      />
      <span
        className="absolute top-[8px] right-[-3px] text-white text-[12px] font-semibold leading-none"
        style={{
          transform: 'rotate(45deg)',
          textShadow: '0 0 1.5px #1d6e00, 0 0 1.5px #1d6e00, 0 0 1.5px #1d6e00',
        }}
      >
        Demo
      </span>
    </div>
  );
}

/** The outlined "Demo" pill on the Accounts list. */
export function DemoPill() {
  return (
    <span className="inline-flex items-center h-[21px] px-[7px] rounded-full border-[1.5px] border-[#4a763b] text-[#5e9949] text-[14px] font-semibold leading-none">
      Demo
    </span>
  );
}
