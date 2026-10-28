import React from 'react';

/**
 * The hamburger on the Chat row.
 *
 * Three bars, the last half-length and flush left. The short bar sits in a full-width track
 * rather than being centred on its own: shrinking a centred bar would pull both ends inward and
 * read as a taper, and left-aligning the column would drag the two full bars off centre with it.
 */
export default function MenuButton() {
  return (
    <div className="w-7 h-7 rounded-full bg-accent-ios flex flex-col items-center justify-center gap-[3px]">
      <div className="w-3.5 h-[1.5px] bg-white rounded-full"></div>
      <div className="w-3.5 h-[1.5px] bg-white rounded-full"></div>
      <div className="w-3.5 flex">
        <div className="w-1/2 h-[1.5px] bg-white rounded-full"></div>
      </div>
    </div>
  );
}
