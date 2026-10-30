import * as React from 'react';
import type { SVGProps } from 'react';

/**
 * Three dots in a row — the "more actions" affordance on a section heading. `dot` is the radius
 * on the 24-unit grid, for a heading that wants heavier dots than the default.
 */
const SvgDotsHorizontal = ({ dot = 1.7, ...props }: SVGProps<SVGSVGElement> & { dot?: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    {...props}
  >
    <circle cx="5" cy="12" r={dot} />
    <circle cx="12" cy="12" r={dot} />
    <circle cx="19" cy="12" r={dot} />
  </svg>
);

export default SvgDotsHorizontal;
