import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    // Pinning the id keeps an already-installed copy updating in place instead of Chrome
    // treating a start_url change as a different app.
    id: '/',
    name: 'MetaTrader 5',
    short_name: 'MetaTrader 5',
    description: 'MetaTrader 5',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#000000',
    theme_color: '#000000',
    icons: [
      // `any` icons are drawn whole. Chrome needs a real >=512 one for the install prompt
      // and the Android launch screen -- the old entry pointed at a 230x230 file while
      // claiming 512x512, so the splash was an upscale of a small bitmap.
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // `maskable` icons get cropped by the launcher's shape, so these carry the art inside
      // the centre 80% safe zone. Without them Android shrinks the `any` icon into a white
      // circle instead.
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
