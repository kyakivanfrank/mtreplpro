import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { appleStartupImages } from '../lib/splashScreens';
import PwaRegister from '@/components/ui/PwaRegister';
import SplashScreen from '@/components/ui/SplashScreen';
import './globals.css';

export const dynamic = 'force-dynamic';

// Inter ships in the repo (app/fonts) rather than being fetched from Google at build or at
// runtime -- nothing to download, nothing to fail, and it works offline once the PWA is
// installed. One variable file covers 100-900, so every weight the UI asks for is real
// rather than synthesised. Exposed as --font-inter so only the rows that opt in via
// `font-inter` (the summary blocks and the price-arrow lines) leave the system stack.
const inter = localFont({
  src: './fonts/Inter-Variable-latin.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-inter',
  display: 'swap',
});

// Outfit Medium, loaded from public/ rather than copied into app/fonts because that file is
// the source: it is a hand-edited cut, not the stock Google release, and a second copy is a
// second thing to forget to re-edit. next/font hashes and serves it from /_next/static/media
// either way, so nothing is fetched at runtime.
//
// One static weight, declared as the 500 it actually is. Every element that opts in already
// carries `font-semibold` from its system-stack days, and a browser answers that on a
// single-weight family by smearing the glyphs sideways -- see the `font-synthesis-weight`
// rule in globals.css, which turns that off so the edited outlines render as drawn.
const outfit = localFont({
  src: '../public/OFBold-Frank.woff',
  weight: '500',
  style: 'normal',
  variable: '--font-outfit',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'MT5',
  description: '', // description shoulid stay blank
  // app/manifest.ts serves at /manifest.webmanifest; /manifest.json 404s, which silently
  // blocked installability — and an installed PWA is what gets storage persistence granted.
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MT5',
    // Without these the home-screen icon opens onto a blank white panel until first paint.
    // iOS never scales a launch image, so each screen size needs an exact match and there is
    // no fallback -- see lib/splashScreens.ts.
    startupImage: appleStartupImages,
  },
  other: {
    // Next 16 emits only the modern `mobile-web-app-capable` for appleWebApp.capable.
    // Safari didn't honour that name until iOS 17.4; before that it reads the apple-prefixed
    // one, and without it the app opens in a Safari view with browser chrome instead of
    // standalone. Cheap insurance, and inert on anything current.
    'apple-mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
};
//  DBFROM="kyakivanfrank@gmail.com"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`bg-black ${inter.variable} ${outfit.variable}`}>
      <body className="bg-black">
        <PwaRegister />
        <SplashScreen />
        {children}
      </body>
    </html>
  );
}
