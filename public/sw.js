/* eslint-disable no-restricted-globals */
/**
 * Offline-first service worker.
 *
 * The app must open and stay usable with no network at all: saved settings, cached bars and
 * the last known prices are already on the device, so the only thing standing between the
 * user and a working terminal is the shell itself being fetchable. This caches it.
 *
 * Strategy per request type:
 *   navigation      network-first, falling back to the cached page — online gets fresh HTML,
 *                   offline still opens.
 *   /_next/static   cache-first. Filenames are content-hashed, so a hit is always correct.
 *   /api/mt5/*      not touched at all. Bars live in IndexedDB, and the routes are
 *                   already cached at the CDN edge.
 *   /api/*          network-first, falling back to the last successful response. Offline that
 *                   means slightly stale prices rather than an error.
 *   everything else stale-while-revalidate: instant from cache, refreshed in the background.
 *
 * Bump CACHE_VERSION to retire old caches on the next activation.
 */

// v4: retires every cache written by v3. One of them was full of dev-server chunks that
// should never have been cached at all -- see isBypassed -- and an activation is the only
// thing that clears a cache-first entry once it is in there.
const CACHE_VERSION = 'v8';
const SHELL_CACHE = `mt5-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `mt5-assets-${CACHE_VERSION}`;
const API_CACHE = `mt5-api-${CACHE_VERSION}`;

const SHELL_URLS = ['/', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one 404 can't fail the whole install.
      await Promise.allSettled(SHELL_URLS.map((url) => cache.add(url)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE, API_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name)));
      await self.clients.claim();
    })()
  );
});

/**
 * Anything the development server owns is off limits.
 *
 * `/_next/static/` is cache-first below, which is safe in production because those filenames
 * are content-hashed — a hit is always the right bytes. In development they are not: Turbopack
 * serves stable paths like `/_next/static/chunks/app/page.js` and rewrites what is behind them
 * on every edit. Cached once, that name would return the same stale chunk forever, and the app
 * would keep rendering code the developer had already deleted.
 *
 * Detected by host rather than by path, because the dev server no longer marks its assets in
 * any way this can match.
 */
function isDevHost() {
  const { hostname, port } = self.location;
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    port === '3000'
  );
}

function isBypassed(url) {
  return (
    isDevHost() ||
    url.pathname.startsWith('/_next/webpack-hmr') ||
    url.pathname.startsWith('/__nextjs') ||
    url.pathname.includes('/_next/static/development/') ||
    url.searchParams.has('__nextDataReq')
  );
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    // Opaque and error responses are not worth persisting.
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    if (fallbackUrl) {
      const shell = await caches.open(SHELL_CACHE);
      const fallback = await shell.match(fallbackUrl);
      if (fallback) return fallback;
    }

    return new Response(
      JSON.stringify({ error: 'Offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);

  return cached || (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET is cacheable, and cross-origin traffic is left entirely alone.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isBypassed(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, '/'));
    return;
  }

  /*
   * Market data is never cached here.
   *
   * It is already persisted twice over — the downloader writes every bar into IndexedDB,
   * which is the app's actual store, and the routes carry CDN cache headers of their own.
   * A third copy would put hundreds of megabytes of duplicate windows in the cache, and
   * serving a stale one offline would be worse than failing: the downloader would merge
   * yesterday's bars, see no gap, and believe it had refreshed.
   */
  if (url.pathname.startsWith('/api/mt5/')) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
});
