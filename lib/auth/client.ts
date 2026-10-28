'use client';

import { useCallback, useEffect, useState } from 'react';
import { readSetting, writeSetting } from '@/lib/storage';

/* ------------------------------------------------------------------ */
/*  Client-side session                                                */
/* ------------------------------------------------------------------ */
/**
 * Reconciles two requirements that pull against each other: a login wall, and an app that must
 * keep working with no network.
 *
 * The resolution is that the *proof* of sign-in is an httpOnly cookie the server verifies,
 * while a small non-authoritative note of "this device is signed in" lives on the device. On
 * launch the app trusts the local note immediately — so it opens offline — and revalidates in
 * the background.
 *
 * Being unable to reach the server is explicitly NOT treated as being signed out. That
 * distinction is the whole reason offline use survives. The local note carries its own thirty
 * day expiry so a device that never comes back online still eventually asks for the password,
 * matching the cookie it stands in for.
 */

const SESSION_KEY = 'auth.session';

/** Kept in step with SESSION_MAX_AGE_SECONDS on the server. */
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export interface CachedSession {
  username: string;
  /** When the server last confirmed this. */
  validatedAt: number;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; username: string; offline: boolean }
  | { status: 'anonymous' };

function cacheSession(username: string): void {
  writeSetting<CachedSession>(SESSION_KEY, { username, validatedAt: Date.now() });
}

function clearCachedSession(): void {
  writeSetting<CachedSession | null>(SESSION_KEY, null);
}

/** Returns the note only while it is inside the same window the cookie would be. */
function readCachedSession(): CachedSession | null {
  const cached = readSetting<CachedSession | null>(SESSION_KEY, null);
  if (!cached?.username) return null;
  if (Date.now() - cached.validatedAt > SESSION_MS) return null;
  return cached;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  /** Ask the server who we are. Network failure leaves any existing session intact. */
  const revalidate = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/auth/session', { cache: 'no-store' });
      const data: { authenticated?: boolean; username?: string } = await res.json();

      if (data.authenticated && data.username) {
        cacheSession(data.username);
        setState({ status: 'authenticated', username: data.username, offline: false });
        return;
      }

      clearCachedSession();
      setState({ status: 'anonymous' });
    } catch {
      // Offline. Silence here is deliberate: the cached session stands.
    }
  }, []);

  useEffect(() => {
    const cached = readCachedSession();

    // Trust the device first so an offline launch isn't held behind a network round trip.
    if (cached) {
      setState({ status: 'authenticated', username: cached.username, offline: !navigator.onLine });
    } else {
      setState({ status: 'anonymous' });
    }

    void revalidate();

    const onOnline = () => void revalidate();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [revalidate]);

  /** Sign in only. There is no registration path — the credential is issued, never created. */
  const submit = useCallback(
    async (
      username: string,
      password: string
    ): Promise<{ ok: true } | { ok: false; error: string; blocked?: boolean }> => {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });

        const data: { username?: string; error?: string } = await res.json();

        if (!res.ok || !data.username) {
          return { ok: false, error: data.error ?? 'Something went wrong. Try again.' };
        }

        cacheSession(data.username);
        setState({ status: 'authenticated', username: data.username, offline: false });
        return { ok: true };
      } catch {
        /**
         * Being offline is not a wrong password.
         *
         * `blocked` tells the gate this attempt was obstructed rather than refused, so it
         * neither spends one of the user's two chances nor blames credentials that were fine.
         * It is the only obstruction left — rate limiting and device binding are gone.
         */
        return {
          ok: false,
          error: 'No connection. Signing in needs internet once.',
          blocked: true,
        };
      }
    },
    []
  );

  const signOut = useCallback(async (): Promise<void> => {
    clearCachedSession();
    setState({ status: 'anonymous' });
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Already signed out locally; the cookie lapses on its own.
    }
  }, []);

  return { state, submit, signOut, revalidate };
}
