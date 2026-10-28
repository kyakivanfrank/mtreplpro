import * as React from 'react';
import type { SVGProps } from 'react';

/**
 * The card mark on the Trade header's balance button.
 *
 * Fill stays the literal `#8e8e93e0` rather than `currentColor` — the button has no text colour
 * to inherit and the alpha is part of the mark. Pass `fill` to override.
 */
const SvgCreditCard = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="23"
    height="23"
    viewBox="-0.253 0.107 18.88 18.88"
    fill="#8e8e93e0"
    aria-hidden="true"
    {...props}
  >
    {/* card outline */}
    <path d="M17.926 14.547h-.701c0 .16-.14.3-.299.3H1.45c-.16 0-.3-.14-.3-.3v-10c0-.16.14-.3.3-.3h15.476c.159 0 .299.14.299.3v10zh.699v-10a1.7 1.7 0 0 0-1.699-1.7H1.45c-.94.003-1.697.76-1.7 1.7v10.001c.003.939.76 1.697 1.7 1.7h15.476a1.7 1.7 0 0 0 1.699-1.7h-.699z" />
    {/* magnetic strip + number blocks */}
    <path d="M.45 7.935h17.476V6.534H.45M3.219 9.781h1.563v1.391H3.219zM6.719 9.781h1.563v1.391H6.719zM10.219 9.781h1.563v1.391h-1.563zM13.719 9.781h1.563v1.391h-1.563z" />
  </svg>
);

export default SvgCreditCard;
