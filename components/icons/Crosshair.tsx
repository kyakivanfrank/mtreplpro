import * as React from "react";
import type { SVGProps } from "react";

const SvgCrosshair = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    viewBox="0 0 13.88 14.535"
    fill="currentColor"
    {...props}
  >
    <g>
      <rect x="6.5" width="1.5" height="5.62" />
      <rect x="6.5" y="9.12" width="1.5" height="5.415" />
      <line x1="8" y1="9.12" x2="6.5" y2="9.12" />
      <rect y="6.62" width="5.5" height="1.5" />
      <rect x="9" y="6.62" width="4.88" height="1.5" />
    </g>
  </svg>
);

export default SvgCrosshair;
