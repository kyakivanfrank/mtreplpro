/**
 * iOS launch images ("apple-touch-startup-image").
 *
 * Without these, tapping the home-screen icon shows a blank white panel until the first
 * paint — the one thing that most gives an installed PWA away as a web page. iOS will not
 * scale a launch image: it only uses one whose media query matches the device *exactly*, so
 * every screen size needs its own file and there is no generic fallback.
 *
 * Single source of truth for both the <link> tags and `scripts/generate-splash.mjs`, which
 * renders the PNGs. Add a device here and re-run the script; never edit one side alone.
 */

export interface SplashDevice {
  /** Marketing names, for the reader's benefit only — nothing keys off these. */
  readonly devices: string;
  /** Logical (CSS) width and height in portrait. */
  readonly width: number;
  readonly height: number;
  /** devicePixelRatio. */
  readonly scale: 2 | 3;
}

export const SPLASH_DEVICES: readonly SplashDevice[] = [
  { devices: 'iPhone SE (2nd/3rd gen), 8, 7, 6s', width: 375, height: 667, scale: 2 },
  { devices: 'iPhone 8 Plus, 7 Plus, 6s Plus', width: 414, height: 736, scale: 3 },
  { devices: 'iPhone 11, XR', width: 414, height: 896, scale: 2 },
  { devices: 'iPhone 11 Pro Max, XS Max', width: 414, height: 896, scale: 3 },
  { devices: 'iPhone 13 mini, 12 mini, 11 Pro, XS, X', width: 375, height: 812, scale: 3 },
  { devices: 'iPhone 16e, 14, 13, 12', width: 390, height: 844, scale: 3 },
  { devices: 'iPhone 15 Pro, 15, 14 Pro', width: 393, height: 852, scale: 3 },
  { devices: 'iPhone 17, 16 Pro, 16', width: 402, height: 874, scale: 3 },
  { devices: 'iPhone 14 Plus, 13 Pro Max, 12 Pro Max', width: 428, height: 926, scale: 3 },
  { devices: 'iPhone 15 Pro Max, 15 Plus, 14 Pro Max', width: 430, height: 932, scale: 3 },
  { devices: 'iPhone 17 Pro Max, 16 Pro Max, 16 Plus', width: 440, height: 956, scale: 3 },
  { devices: 'iPad 10.9"', width: 820, height: 1180, scale: 2 },
  { devices: 'iPad Pro 11", iPad Air 10.9"', width: 834, height: 1194, scale: 2 },
  { devices: 'iPad Pro 12.9"', width: 1024, height: 1366, scale: 2 },
];

/** Where a device's launch image lives, named by its real pixel dimensions. */
export function splashUrl(pixelWidth: number, pixelHeight: number): string {
  return `/splash/${pixelWidth}x${pixelHeight}.png`;
}

/**
 * Both orientations for every device.
 *
 * iOS does not honour the manifest's `orientation` member, so a home-screen app can be
 * launched with the device already held sideways. Only `orientation` flips between the two
 * queries: iOS reports `device-width`/`device-height` in portrait terms regardless of how
 * the device is being held, while the image itself has to be the rotated one.
 */
export const appleStartupImages = SPLASH_DEVICES.flatMap(({ width, height, scale }) => {
  const w = width * scale;
  const h = height * scale;
  const device =
    `(device-width: ${width}px) and (device-height: ${height}px) and ` +
    `(-webkit-device-pixel-ratio: ${scale})`;

  return [
    { url: splashUrl(w, h), media: `${device} and (orientation: portrait)` },
    { url: splashUrl(h, w), media: `${device} and (orientation: landscape)` },
  ];
});
