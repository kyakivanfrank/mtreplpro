import { NextRequest, NextResponse } from 'next/server';
import {
  checkCredentials,
  credentials,
  issueSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/lib/auth/session';

/**
 * Sign in. Compare two strings, set one cookie.
 *
 * No rate limiting, no device binding, no database. The credential is shared on purpose, so
 * there is nothing here to guess that isn't already handed out, and every guard that used to
 * sit at this door turned out to reject far more real users than imaginary attackers.
 */
export async function POST(request: NextRequest) {
  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const username = body.username ?? '';
  const password = body.password ?? '';

  if (!username.trim() || !password.trim()) {
    return NextResponse.json({ error: 'Enter your username and password.' }, { status: 400 });
  }

  if (!checkCredentials(username, password)) {
    return NextResponse.json({ error: 'Incorrect username or password.' }, { status: 401 });
  }

  // Echo the canonical spelling back, so the app displays it the way it was issued.
  const response = NextResponse.json({ username: credentials().username });
  response.cookies.set(SESSION_COOKIE, issueSession(), sessionCookieOptions());
  return response;
}
