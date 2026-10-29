import * as React from 'react';
import type { SVGProps } from 'react';

/** Three bullets and three lines, the Quotes header's view-mode button. */
const SvgListBullet = (props: SVGProps<SVGSVGElement>) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <circle cx="4" cy="6" r="1.6" />
    <circle cx="4" cy="12" r="1.6" />
    <circle cx="4" cy="18" r="1.6" />
    <rect x="8" y="4.9" width="13" height="2.2" rx="1.1" />
    <rect x="8" y="10.9" width="13" height="2.2" rx="1.1" />
    <rect x="8" y="16.9" width="13" height="2.2" rx="1.1" />
  </svg>
);
export default SvgListBullet;
