import * as React from "react";
import type { SVGProps } from "react";

const SvgPositioners = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    viewBox="0 0 16.369 16.37"
    {...props}
  >
    <g>
      <path fill="#D15247" d="M3.31,8.18c0,2.94,1.95,5.34,4.44,5.601v1.449C3.43,15.031,0,11.96,0,8.19c0-3.78,3.43-6.85,7.75-7.05v1.45 C5.26,2.851,3.31,5.25,3.31,8.18z" />
      <path fill="#4786DC" d="M16.369,8.19c0,3.77-3.43,6.84-7.75,7.04v-1.449c2.49-0.261,4.44-2.66,4.44-5.601 c0-2.93-1.95-5.33-4.44-5.59V1.14C12.939,1.34,16.369,4.41,16.369,8.19z" />
      <polygon fill="#B8BBBF" points="7.562,4.649 7.235,8.328 9.405,11.3 10.214,10.71 8.265,8.042 8.558,4.737" />
    </g>
  </svg>
);

export default SvgPositioners;
