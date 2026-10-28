/**
 * Erase everything the old account system left in Upstash.
 *
 *   node scripts/purge-auth.mjs          # show what would go, touch nothing
 *   node scripts/purge-auth.mjs --yes    # actually delete it
 *
 * Authentication no longer uses the database at all — one credential pair lives in the
 * environment and sessions are signed cookies — so these keys are dead weight holding password
 * hashes and sign-in history that nothing reads any more:
 *
 *   mt5:user:*        account records, including scrypt password hashes
 *   mt5:user:*:logins per-account sign-in trails (device, IP, user agent)
 *   mt5:session:*     server-side sessions
 *   mt5:active:*      single-device pointers
 *   mt5:attempts:*    rate-limit counters
 *
 * mt5:book:* is NOT touched. That is the saved trading account — positions, orders, closed
 * deals — and has nothing to do with passwords.
 */
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const BASE = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, '');
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!BASE || !TOKEN) {
  console.error('Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN in .env.local');
  process.exit(1);
}

const APPLY = process.argv.includes('--yes');

async function redis(args) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args.map(String)),
  });
  if (!res.ok) throw new Error(`redis HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error);
  return body.result;
}

/** KEYS is fine here: this keyspace is tens of entries, not millions. */
async function keys(pattern) {
  return (await redis(['KEYS', pattern])) ?? [];
}

const PATTERNS = ['mt5:user:*', 'mt5:session:*', 'mt5:active:*', 'mt5:attempts:*'];

const found = [];
for (const pattern of PATTERNS) {
  const matched = await keys(pattern);
  console.log(`  ${pattern.padEnd(18)} ${matched.length}`);
  found.push(...matched);
}

const books = await keys('mt5:book:*');
console.log(`\n  mt5:book:*         ${books.length}  (kept — trading data, not credentials)\n`);

if (found.length === 0) {
  console.log('Nothing to purge.\n');
  process.exit(0);
}

if (!APPLY) {
  console.log(`Dry run: ${found.length} key(s) would be deleted. Re-run with --yes to apply.\n`);
  process.exit(0);
}

// Batched so one oversized command can't be rejected.
for (let i = 0; i < found.length; i += 50) {
  await redis(['DEL', ...found.slice(i, i + 50)]);
}

const leftover = (await Promise.all(PATTERNS.map(keys))).flat();
console.log(`Deleted ${found.length} key(s). Remaining auth keys: ${leftover.length}.\n`);
