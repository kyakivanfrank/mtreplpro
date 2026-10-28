'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The gate: two fields, no button.
 *
 * Correct credentials sign themselves in — the form submits on its own once both fields have
 * settled. A wrong pair costs one of two chances; when they run out the fields disappear and
 * only a reload brings them back.
 *
 * Two guards keep the automatic submission from eating chances unfairly: it waits for typing
 * to pause, and it refuses to retry a username/password pair it has already sent. Without the
 * second, every re-render would re-fire the same failing attempt.
 */
interface LoginWallProps {
  onSubmit: (
    username: string,
    password: string
  ) => Promise<{ ok: true } | { ok: false; error: string; blocked?: boolean }>;
}

const MAX_ATTEMPTS = 2;

/** Shown while the user still has tries left; these are randomized so the tone feels personal. */
const TRY_MESSAGES = [
  'If you don\'t have the right password, biveeko 😡',
  'Write the wrong password again, Ojjakundaba 😠',
  'Neesonyiwa 😏  your password is wrong',
];

function nextTryMessage(lastIndex: number): { message: string; index: number } {
  let nextIndex = Math.floor(Math.random() * TRY_MESSAGES.length);

  if (TRY_MESSAGES.length > 1 && nextIndex === lastIndex) {
    nextIndex = (nextIndex + 1) % TRY_MESSAGES.length;
  }

  return {
    message: TRY_MESSAGES[nextIndex],
    index: nextIndex,
  };
}

/** Shown once the chances run out and the fields disappear; one is picked at random. */
const LOCKOUT_MESSAGES = [
  'Sinikira muli ebinnyo',
  'Komanyoko 😡',
  'Yasamira muli 😠',
  'Laba nno kino ekisiru 😏',
  '😏  Olowooza bino onobisobola?',
];

function lockoutMessage(): string {
  return LOCKOUT_MESSAGES[Math.floor(Math.random() * LOCKOUT_MESSAGES.length)];
}

/** Long enough that a slow typist isn't charged an attempt mid-password. */
const SETTLE_MS = 1200;

/** Issued passwords are exactly this long, so the field caps here and submits on the last character. */
const PASSWORD_LENGTH = 6;

/**
 * Issued usernames are exactly this long too, and the form will not fire until it sees it.
 *
 * This was previously 3, which meant a username still being typed could be submitted the
 * moment the typist paused — "userf" going in instead of "userfd". The attempt failed, a
 * chance was spent, and the message blamed the credentials, which were fine. Waiting for a
 * complete username costs nothing: a shorter one could never have been valid anyway.
 */
const USERNAME_LENGTH = 6;

export default function LoginWall({ onSubmit }: LoginWallProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_ATTEMPTS);
  /** Toggling this re-renders but never re-fires the attempt: it isn't one of the effect's deps. */
  const [reveal, setReveal] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** The last pair actually sent, so identical values are never submitted twice. */
  const lastTried = useRef('');
  const lastTryIndex = useRef(-1);

  const lockedOut = attemptsLeft <= 0;

  useEffect(() => {
    if (lockedOut || busy) return;

    const user = username.trim();
    if (user.length < USERNAME_LENGTH || password.length < PASSWORD_LENGTH) return;

    const pair = `${user}:${password}`;
    if (lastTried.current === pair) return;

    const timer = setTimeout(async () => {
      lastTried.current = pair;
      setBusy(true);
      setMessage(null);

      const result = await onSubmit(user, password);

      if (!result.ok) {
        /**
         * Something obstructing the attempt is not a wrong password.
         *
         * Rate limiting, an account already claimed by another browser, and being offline all
         * used to surface as "your password is wrong" and spend one of the two chances. That
         * sent people back to re-check credentials that were correct the whole time. These now
         * say what actually happened and cost nothing.
         */
        if (result.blocked) {
          setMessage(result.error);
          // Cleared so the very same pair can be retried once the obstacle passes.
          lastTried.current = '';
        } else {
          setAttemptsLeft((remaining) => {
            const left = remaining - 1;

            if (left > 0) {
              const next = nextTryMessage(lastTryIndex.current);
              lastTryIndex.current = next.index;
              setMessage(next.message);
            } else {
              setMessage(lockoutMessage());
            }

            return left;
          });
        }
      }

      setBusy(false);
    }, SETTLE_MS);

    return () => clearTimeout(timer);
  }, [username, password, lockedOut, busy, onSubmit]);

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-black text-white font-sans pt-[var(--safe-top)] pb-[var(--safe-bottom)] overflow-y-auto">
      <div className="flex-1 flex flex-col justify-center px-8 py-10 max-w-[420px] w-full mx-auto">
        {!lockedOut && (
          <div className={`bg-surface rounded-[12px] px-4 mb-4 transition-opacity ${busy ? 'opacity-50' : ''}`}>
            <div className="flex items-center py-2 min-h-[50px] border-b border-hairline">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={busy}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                spellCheck={false}
                className="flex-1 bg-transparent text-white outline-none text-[17px] placeholder-faint disabled:text-muted"
                placeholder="Username"
              />
            </div>
            <div className="flex items-center gap-3 py-2 min-h-[50px]">
              {/* The password is compared exactly, so the keyboard must not "help". Several
                  Android keyboards capitalise the first character even in a password field,
                  which silently turns KDp6Nt into Kdp6nt and reads back as a wrong password. */}
              <input
                type={reveal ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value.slice(0, PASSWORD_LENGTH))}
                disabled={busy}
                maxLength={PASSWORD_LENGTH}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="current-password"
                spellCheck={false}
                className="flex-1 min-w-0 bg-transparent text-white outline-none text-[17px] placeholder-faint disabled:text-muted"
                placeholder="Password"
              />
              {/* Mixed-case characters behind dots are the easiest thing in the world to
                  mistype, and you only get two goes at it. */}
              <button
                type="button"
                onClick={() => setReveal((shown) => !shown)}
                className="shrink-0 text-[15px] text-accent disabled:text-faint"
                disabled={busy}
              >
                {reveal ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
        )}

        {message && (
          <div className="text-danger text-[14px] leading-[19px] px-1">{message}</div>
        )}
      </div>
    </div>
  );
}
