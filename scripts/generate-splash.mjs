/**
 * Renders the iOS launch images described by lib/splashScreens.ts.
 *
 *   node scripts/generate-splash.mjs
 *
 * Art direction matches components/SplashScreen.tsx exactly — same black field, same 160pt
 * centred mark — so the native launch image and the React splash that replaces it are the
 * same picture, and the handover is invisible instead of a jump.
 *
 * Re-run after adding a device to SPLASH_DEVICES; the table is the single source of truth
 * for both these files and the <link> tags.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

import { SPLASH_DEVICES, splashUrl } from '../lib/splashScreens.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(import.meta.url)(
  createRequire(import.meta.url).resolve('sharp', { paths: [ROOT] })
);

const SRC = path.join(ROOT, 'components/icons/mt5realicon.svg');
const OUT = path.join(ROOT, 'public/splash');

/** Matches `background_color` in the manifest and `bg-black` on the app shell. */
const BACKGROUND = { r: 0, g: 0, b: 0, alpha: 1 };
/** Logical size of the mark, in points. `h-40 w-40` in components/SplashScreen.tsx. */
const LOGO_PT = 160;

async function render({ width, height, scale }) {
  const logo = await sharp(SRC, { density: 2400 })
    .resize(LOGO_PT * scale, LOGO_PT * scale, { fit: 'cover' })
    .png()
    .toBuffer();

  // Portrait, then the same canvas rotated. Composing landscape from the portrait pixel
  // dimensions swapped keeps the mark identically sized in both.
  return Promise.all(
    [
      [width * scale, height * scale],
      [height * scale, width * scale],
    ].map(async ([w, h]) => {
      const file = path.join(ROOT, 'public', splashUrl(w, h));
      await sharp({ create: { width: w, height: h, channels: 4, background: BACKGROUND } })
        .composite([{ input: logo, gravity: 'centre' }])
        .png({ compressionLevel: 9, palette: true })
        .toFile(file);
      return file;
    })
  );
}

const seen = new Map();
for (const { devices, width, height, scale } of SPLASH_DEVICES) {
  for (const [w, h] of [[width * scale, height * scale], [height * scale, width * scale]]) {
    const url = splashUrl(w, h);
    // Two device classes sharing a pixel size would silently overwrite each other, and the
    // second one's media query would then point at the first one's art.
    if (seen.has(url) && seen.get(url) !== devices) {
      throw new Error(`${url} is claimed by both "${seen.get(url)}" and "${devices}"`);
    }
    seen.set(url, devices);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let bytes = 0;
for (const device of SPLASH_DEVICES) {
  for (const file of await render(device)) {
    const { size } = fs.statSync(file);
    bytes += size;
    console.log(`${path.basename(file).padEnd(14)} ${(size / 1024).toFixed(1).padStart(7)} KB   ${device.devices}`);
  }
}
console.log(`\n${seen.size} images, ${(bytes / 1024).toFixed(0)} KB total`);
