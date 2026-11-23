import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication } from '../server.mjs';
import { createShareGateway } from './share-gateway.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const logs = join(root, 'logs');
mkdirSync(logs, { recursive: true });
const statePath = join(logs, 'share-state.json');
const linkPath = join(logs, 'share-url.txt');
const tunnelPath = join(root, '.runtime', 'cloudflared.exe');
if (!existsSync(tunnelPath)) throw new Error('Missing .runtime/cloudflared.exe. See README sharing setup.');

const controlKey = randomBytes(32).toString('hex');
const shareKey = randomBytes(32).toString('hex');
let gateway, tunnel, ready = false, closing = false, app;
let publicOrigin = '';
const safeEqual = (a, b) => {
  if (typeof a !== 'string') return false;
  const actual = Buffer.from(a), expected = Buffer.from(b);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};
const listen = (server, port = 0) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); });
});
const edge = http.createServer((req, res) => {
  if (gateway) return gateway.emit('request', req, res);
  res.writeHead(503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  res.end('Share is starting.');
});
edge.requestTimeout = 30000;
edge.headersTimeout = 15000;
const rejectUpgrade = (_req, socket) => socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
edge.on('upgrade', rejectUpgrade);
edge.on('connect', rejectUpgrade);

const control = http.createServer((req, res) => {
  if (!safeEqual(req.headers.authorization || '', `Bearer ${controlKey}`)) {
    res.writeHead(403); res.end(); return;
  }
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url === '/status') {
    res.end(JSON.stringify({ app: 'hongson-share', ready, url: ready ? `${publicOrigin}/#key=${shareKey}` : null }));
  } else if (req.method === 'POST' && req.url === '/stop') {
    res.end(JSON.stringify({ stopped: true }));
    setTimeout(() => shutdown(0), 100);
  } else { res.writeHead(404); res.end('{}'); }
});

async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  ready = false;
  if (tunnel && tunnel.exitCode === null) tunnel.kill();
  edge.closeAllConnections();
  control.closeAllConnections();
  edge.close();
  control.close();
  if (app) {
    app.server.closeAllConnections();
    await app.close().catch(() => {});
  }
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (state.pid === process.pid) { unlinkSync(statePath); if (existsSync(linkPath)) unlinkSync(linkPath); }
  } catch {}
  process.exit(code);
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
process.on('uncaughtException', error => { console.error(error.message); shutdown(1); });
process.on('unhandledRejection', error => { console.error(error?.message || 'Share failed'); shutdown(1); });

try {
  // A fixed loopback control listener also prevents overlapping share processes.
  const controlPort = await listen(control, 4312);
  // This database is deliberately separate from the user's local working data.
  app = createApplication({ dbPath: join(root, 'data', 'hongson-share.sqlite') });
  const targetPort = await listen(app.server);
  const edgePort = await listen(edge);
  const state = { pid: process.pid, controlPort, controlKey, createdAt: new Date().toISOString(), ready: false };
  const saveState = () => { writeFileSync(`${statePath}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 }); renameSync(`${statePath}.tmp`, statePath); };
  saveState();
  const tunnelLog = join(logs, 'share-tunnel.log');
  writeFileSync(tunnelLog, '');
  tunnel = spawn(tunnelPath, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${edgePort}`], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  state.tunnelPid = tunnel.pid;
  saveState();
  let pending = '';
  let connected = false;
  const deadline = setTimeout(() => { console.error('Tunnel was not ready within 90 seconds. See logs/share-tunnel.log.'); shutdown(1); }, 90000);
  const acceptOutput = chunk => {
    const value = chunk.toString();
    appendFileSync(tunnelLog, value);
    pending = (pending + value).slice(-20000);
    const found = pending.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\b/);
    if (found && !publicOrigin) {
      publicOrigin = found[0];
      gateway = createShareGateway({ targetPort, shareKey, publicOrigin });
    }
    if (/Registered tunnel connection/.test(pending)) connected = true;
    if (!ready && gateway && connected) {
      ready = true;
      clearTimeout(deadline);
      state.ready = true;
      state.url = `${publicOrigin}/#key=${shareKey}`;
      saveState();
      writeFileSync(linkPath, state.url + '\r\n', { mode: 0o600 });
      console.log('Hongson temporary share is ready. Link: logs/share-url.txt');
    }
  };
  tunnel.stdout.on('data', acceptOutput);
  tunnel.stderr.on('data', acceptOutput);
  tunnel.on('error', error => { console.error(`Tunnel: ${error.message}`); shutdown(1); });
  tunnel.on('exit', code => { if (!closing) { console.error(`Tunnel stopped (${code}).`); shutdown(code || 1); } });
} catch (error) { console.error(error.message); await shutdown(1); }
