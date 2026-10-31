import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { appleStartupImages } from '../lib/splashScreens';
import PwaRegister from '@/components/ui/PwaRegister';
import SplashScreen from '@/components/ui/SplashScreen';
import './globals.css';

export const dynamic = 'force-dynamic';

// The terminal's second face. MT5 sets symbols, sides, volumes, P/L and the big quote digits in
// Roboto Condensed and everything else in the system font; matched glyph-for-glyph against the
// real app's screenshots (see docs/MT5_PARITY.md). Self-hosted so it renders identically on every
// phone and offline. Variable 100-900, Latin subset.
const mt5Condensed = localFont({
  src: './fonts/RobotoCondensed-Variable-latin-frank.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-mt5-condensed',
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
    <html lang="en" className={`bg-black ${mt5Condensed.variable}`}>
      <body className="bg-black">
        <PwaRegister />
        <SplashScreen />
        {children}
      </body>
    </html>
  );
}
