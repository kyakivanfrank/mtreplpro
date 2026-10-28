import { createHmac, timingSafeEqual } from 'node:crypto';

/* ------------------------------------------------------------------ */
/*  The whole of authentication                                        */
/* ------------------------------------------------------------------ */
/**
 * One credential pair, one signed cookie, thirty days. That is all of it.
 *
 * What this replaced: a roster of accounts in Redis, scrypt password hashes, per-account and
 * per-IP rate limiters, and a one-account-one-browser device binding enforced through three
 * more Redis keys. Every one of those was a place a legitimate sign-in could fail for a reason
 * that had nothing to do with the password — a claimed device that couldn't be released, a
 * shared carrier IP that had spent its budget, a cleared localStorage that made the browser
 * look like a stranger. The credential is shared deliberately now: anyone holding it gets in,
 * on as many devices as they like, at the same time.
 *
 * Sessions are stateless. The cookie carries its own expiry and an HMAC over it, so validating
 * one is a hash — no database read, nothing to go stale, and nothing that can sign a user out
 * because a store was briefly unreachable.
 */

/**
 * Falling back to literals rather than throwing is deliberate.
 *
 * A missing environment variable on a deploy would otherwise lock everyone out of an app whose
 * password is not a secret in the first place — it is a doorbell, not a vault. Set
 * AUTH_PASSWORD to change it; leave it unset and the app still opens.
 */
const DEFAULT_USERNAME = 'usergn';
const DEFAULT_PASSWORD = 'KDp6Nt';

export const SESSION_COOKIE = 'mt5_session';

/** Thirty days, then the cookie is spent and the sign-in screen comes back. No sliding. */
export const SESSION_DAYS = 30;
export const SESSION_MAX_AGE_SECONDS = SESSION_DAYS * 24 * 60 * 60;

/**
 * Read as AUTH_USERNAME / AUTH_PASSWORD, not USERNAME / PASSWORD.
 *
 * Windows defines USERNAME in every process's environment, and @next/env refuses to overwrite
 * a variable the OS already set — so `USERNAME=usergn` in .env.local is silently ignored in
 * local development and the app compares against the Windows account name instead. The AUTH_
 * prefix collides with nothing.
 */
export function credentials(): { username: string; password: string } {
  return {
    username: process.env.AUTH_USERNAME?.trim() || DEFAULT_USERNAME,
    password: process.env.AUTH_PASSWORD?.trim() || DEFAULT_PASSWORD,
  };
}

/** The single account's key, used to name its saved book. */
export function accountHandle(): string {
  return credentials().username.toLowerCase();
}

/**
 * Both values are trimmed before comparison, and the username is matched case-insensitively.
 *
 * Phone keyboards capitalise the first character of a text field and paste a trailing space
 * after an autofill, and both used to read back as a wrong password. The password itself is
 * still matched exactly — it is mixed case on purpose — but nothing invisible decides it.
 */
export function checkCredentials(username: string, password: string): boolean {
  const expected = credentials();
  return (
    username.trim().toLowerCase() === expected.username.toLowerCase() &&
    password.trim() === expected.password
  );
}

/** Signing key. Derived from the password, so changing it invalidates every live session. */
function sign(payload: string): string {
  return createHmac('sha256', `mt5-session:${credentials().password}`)
    .update(payload)
    .digest('base64url');
}

/** `<expiresAt>.<signature>` — self-contained, unforgeable without the password. */
export function issueSession(): string {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  return `${expiresAt}.${sign(String(expiresAt))}`;
}

export interface Session {
  username: string;
  handle: string;
  expiresAt: number;
}

export function readSession(cookie: string | undefined): Session | null {
  if (!cookie) return null;

  const separator = cookie.indexOf('.');
  if (separator < 1) return null;

  const payload = cookie.slice(0, separator);
  const signature = cookie.slice(separator + 1);

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);

  // Constant-time: a plain === leaks how much of the signature matched via timing.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  return { username: credentials().username, handle: accountHandle(), expiresAt };
}

/** Cookie attributes. httpOnly keeps the token unreadable by any script on the page. */
export function sessionCookieOptions(maxAge = SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}
