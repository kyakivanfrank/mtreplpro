// `npm run tunnel` used to only start cloudflared. cloudflared's connectivity prechecks test
// its own link to Cloudflare's edge, not whether anything is listening on 127.0.0.1:3000 — so a
// tunnel could come up "healthy" while pointing at a dev server nobody started, and the public
// URL would just fail to load. This starts `next dev`, waits for port 3000 to actually accept
// connections, then starts cloudflared — and tears down the dev server if the tunnel exits.
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';

const PORT = 3000;

function waitForPort(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = createConnection({ port, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`Nothing listening on 127.0.0.1:${port} after ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 300);
        }
      });
    };
    attempt();
  });
}

const dev = spawn(process.execPath, ['scripts/next.mjs', 'dev'], {
  stdio: 'inherit',
});

let tunnel;
const cleanup = () => {
  tunnel?.kill();
  dev.kill();
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
dev.on('exit', (code, signal) => {
  if (!tunnel) process.exit(signal ? 1 : (code ?? 0));
});

try {
  console.log(`[tunnel] waiting for http://127.0.0.1:${PORT} ...`);
  await waitForPort(PORT);
  console.log('[tunnel] dev server is up, starting cloudflared');
  tunnel = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${PORT}`], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  tunnel.on('exit', (code, signal) => {
    dev.kill();
    process.exit(signal ? 1 : (code ?? 0));
  });
} catch (err) {
  console.error('[tunnel]', err.message);
  dev.kill();
  process.exit(1);
}
