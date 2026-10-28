import React from 'react';

/**
 * The direction glyph on the Δ line. Drawn rather than the ▲/▼ characters, which arrive at
 * whatever weight the fallback face gives them and sit heavier than the figures beside them.
 * One path, rotated for down — a second would only be a chance for the two to drift.
 */
export default function DeltaChevron({ up }: { up: boolean }) {
  return (
    <svg
      width="11"
      height="7"
      viewBox="0 0 11 7"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={`inline-block align-middle ml-0.5 ${up ? '' : 'rotate-180'}`}
    >
      <path
        d="M1.25 5.6 L5.5 1.4 L9.75 5.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
