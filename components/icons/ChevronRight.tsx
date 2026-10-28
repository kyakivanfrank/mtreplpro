import * as React from 'react';
import type { SVGProps } from 'react';

/** The disclosure chevron on a settings row. Rotated 90° by the caller when a list is open. */
const SvgChevronRight = (props: SVGProps<SVGSVGElement>) => (
  <svg width="9" height="14" viewBox="0 0 9 14" fill="none" aria-hidden="true" {...props}>
    <path
      d="M2 1.5L7.5 7L2 12.5"
      stroke="#5c5c5e"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default SvgChevronRight;
