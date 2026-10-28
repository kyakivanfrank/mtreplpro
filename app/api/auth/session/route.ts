import { NextRequest, NextResponse } from 'next/server';
import { readSession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';

/**
 * Whoami. The client calls this on launch and whenever it regains connectivity.
 *
 * Verifying a signature is the entire check, so this cannot fail for any reason other than the
 * cookie being absent, tampered with, or past its thirty days. The expiry is fixed at issue and
 * is deliberately not extended here: a session lasts thirty days from the sign-in that created
 * it, and then asks for the password again.
 */
export async function GET(request: NextRequest) {
  const session = readSession(request.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    const response = NextResponse.json({ authenticated: false }, { status: 401 });
    // Clear a cookie that can never work again so it isn't re-sent on every launch.
    response.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0));
    return response;
  }

  return NextResponse.json({
    authenticated: true,
    username: session.username,
    expiresAt: session.expiresAt,
  });
}
