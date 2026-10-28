'use client';

import { useEffect } from 'react';

/**
 * Installs the service worker — in production only.
 *
 * In development it is a liability rather than a feature. The worker caches `/_next/static/`
 * first-and-ask-later, which is correct for content-hashed production filenames and completely
 * wrong for the dev server's stable ones: the same URL returns different bytes after every
 * edit, so a cached copy pins the app to whatever the code said the first time it was loaded.
 * Compiling cleanly while the browser renders a deleted component is not a bug anyone should
 * have to diagnose twice.
 *
 * So development actively tears it down: any worker a previous run installed is unregistered
 * and its caches deleted. That takes effect on the *next* load, because a worker already
 * controlling this page keeps controlling it until the page is reloaded.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      void (async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));

        if ('caches' in window) {
          const names = await caches.keys();
          await Promise.all(
            names.filter((name) => name.startsWith('mt5-')).map((name) => caches.delete(name))
          );
        }
      })();

      return;
    }

    const install = () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.error('Service Worker registration failed: ', err);
      });
    };

    if (document.readyState === 'complete') install();
    else window.addEventListener('load', install);

    return () => window.removeEventListener('load', install);
  }, []);

  return null;
}
