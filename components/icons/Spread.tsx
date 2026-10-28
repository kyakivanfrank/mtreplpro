import * as React from 'react';
import type { SVGProps } from 'react';

/** The gauge between the tick time and the spread figure on a watchlist row. */
const SvgSpread = (props: SVGProps<SVGSVGElement>) => (
  <svg
    width="10"
    height="8"
    viewBox="0 0 12 10"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden="true"
    {...props}
  >
    <path d="M2 1 v8 M10 1 v8 M2 5 h8" />
  </svg>
);

export default SvgSpread;
