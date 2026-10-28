/* ------------------------------------------------------------------ */
/*  Which account a book belongs to                                    */
/* ------------------------------------------------------------------ */
/**
 * The account number, reduced to something safe to use as a storage key.
 *
 * No `'use client'`, no imports, no React — deliberately. Both the browser and the API route
 * derive keys with this, and if they ever disagreed about what "515995307 " means the device
 * would write to one key and read from another, which presents as an account that empties
 * itself on reload. One function, both sides.
 *
 * ── What this is not ─────────────────────────────────────────────────
 *
 * It is a namespace, not a credential. The number is typed by the user and the session cookie
 * proves nothing about which account is signing in, so anyone who signs in and enters someone
 * else's number reads their book. That is a deliberate choice for this app — the login is a
 * doorbell rather than a vault — but nothing here should be mistaken for access control.
 */

/** Long enough for any broker's account number, short enough that a key cannot be abused. */
export const MAX_ACCOUNT_KEY = 32;

/**
 * Returns null when there is nothing usable, and callers treat that as "do not sync".
 *
 * Falling back to a shared default would be the worst possible failure: every device that
 * cleared its account number would silently land in the same book again, which is the exact
 * problem this exists to fix.
 */
export function normalizeAccountKey(raw: string | null | undefined): string | null {
  const cleaned = (raw ?? '')
    .trim()
    .toLowerCase()
    // Anything that is not a plain identifier character. Account numbers are digits in
    // practice, but a broker suffix or a hyphen should namespace rather than be rejected.
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, MAX_ACCOUNT_KEY);

  return cleaned.length > 0 ? cleaned : null;
}
