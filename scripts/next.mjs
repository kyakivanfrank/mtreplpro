// Launches the Next CLI from the real on-disk path.
//
// Windows paths are case-insensitive, so the project can be entered under a casing that
// differs from the directory's actual name (here: "MT5 REPLICA" vs the on-disk "MT5 replica").
// Turbopack compares resolved module paths against the project root to decide what stays
// external. A case mismatch defeats that comparison, so work-async-storage.external gets
// inlined into the app bundle instead of being externalized. That leaves two separate
// AsyncLocalStorage instances -- the runtime enters one, the bundled metadata code reads the
// other -- and prerendering dies with:
//   Invariant: Expected workStore to be initialized. This is a bug in Next.js.
//
// Normalizing the cwd here makes `next dev`/`build`/`start` behave the same no matter which
// casing the shell or editor used to open the project.
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';

// Both halves have to agree: the project root Next builds AND the path its own modules are
// loaded from. Normalizing only one of them just flips which side of the comparison is wrong.
const cwd = realpathSync.native(process.cwd());
const nextBin = realpathSync.native(
  createRequire(import.meta.url).resolve('next/dist/bin/next')
);

/**
 * Force outbound connections down IPv4.
 *
 * This machine resolves AAAA records but cannot reach them — a raw TCP connect to the IPv6
 * address of both api.twelvedata.com and query1.finance.yahoo.com returns EHOSTUNREACH, while
 * IPv4 connects in under 100ms. Since Node 20, `fetch` tries IPv6 first (Happy Eyeballs) and
 * only falls back after a timeout, so on a network like this every upstream call inherits that
 * stall and a slow one surfaces as `fetch failed`. Because Upstash, Twelve Data and Yahoo all
 * share the one broken path, they appear to fail together, which looks like three outages and
 * is really one.
 *
 *   --dns-result-order=ipv4first   hand IPv4 addresses to the connector first
 *   --no-network-family-autoselection   don't race the families at all
 *
 * Set here rather than in the shell so `dev`, `build` and `start` all get it, on any machine.
 */
const NODE_FLAGS = ['--dns-result-order=ipv4first', '--no-network-family-autoselection'];

spawn(process.execPath, [...NODE_FLAGS, nextBin, ...process.argv.slice(2)], {
  cwd,
  stdio: 'inherit',
  env: {
    ...process.env,
    // Next spawns its own workers; carry the flags into those too.
    NODE_OPTIONS: [process.env.NODE_OPTIONS, ...NODE_FLAGS].filter(Boolean).join(' '),
  },
}).on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
