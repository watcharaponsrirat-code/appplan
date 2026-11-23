import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApplication } from '../server.mjs';
import { createShareGateway } from '../scripts/share-gateway.mjs';

const ORIGIN = 'https://share.test.example';
const KEY = 'a'.repeat(64); // Deliberately fixed test data; never a deployed invitation.
let app, gateway, port, gateCookie;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(server.address().port); });
  });
}
function close(server) { return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
function call(path, { method = 'GET', headers = {}, body, chunked = false, requestPort = port } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port: requestPort, path, method, headers: {
      Host: new URL(ORIGIN).host,
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json', ...(chunked ? { 'Transfer-Encoding': 'chunked' } : { 'Content-Length': Buffer.byteLength(payload) }) }),
      ...headers,
    } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(payload);
  });
}

before(async () => {
  app = createApplication({ dbPath: ':memory:' });
  const targetPort = await listen(app.server);
  gateway = createShareGateway({ targetPort, shareKey: KEY, publicOrigin: ORIGIN });
  port = await listen(gateway);
  const unlock = await call('/_share/unlock', { method: 'POST', headers: { Origin: ORIGIN }, body: { key: KEY } });
  assert.equal(unlock.status, 200);
  gateCookie = unlock.headers['set-cookie'][0].split(';')[0];
});
after(async () => {
  if (gateway?.listening) await close(gateway);
  if (app) await app.close();
});

test('share configuration requires HTTPS and a 32-byte invitation', () => {
  for (const publicOrigin of ['http://share.test.example', 'https://u:p@share.test.example', `${ORIGIN}/path`, `${ORIGIN}/?key=secret`]) {
    assert.throws(() => createShareGateway({ targetPort: 4310, shareKey: KEY, publicOrigin }), /HTTPS/);
  }
  assert.throws(() => createShareGateway({ targetPort: 4310, shareKey: 'short', publicOrigin: ORIGIN }), /32 random bytes/);
});

test('unauthenticated visitors see only the invitation gate and cannot read assets or APIs', async () => {
  const landing = await call('/');
  assert.equal(landing.status, 200);
  assert.match(landing.text, /ลิงก์เชิญฉบับเต็ม/);
  assert.equal(landing.headers['cache-control'], 'no-store');
  assert.equal(landing.headers['referrer-policy'], 'no-referrer');
  assert.equal(landing.headers['x-frame-options'], 'DENY');
  assert.match(landing.headers['x-robots-tag'], /noindex/);
  for (const path of ['/app.js', '/style.css', '/api/health', '/api/bootstrap', '/api/files/test', '/_share/unlock']) {
    assert.equal((await call(path)).status, 403, path);
  }
  const script = await call('/_share/unlock.js');
  assert.equal(script.status, 200);
  assert.match(script.text, /location\.hash/);
  assert.match(script.text, /history\.replaceState/);
  assert.ok(script.text.indexOf('history.replaceState') < script.text.indexOf('fetch('));
  assert.ok(!landing.text.includes(KEY) && !script.text.includes(KEY));
  assert.ok(!JSON.stringify(landing.headers).includes(KEY));
});

test('unlock validates the invitation, body size, and origin before minting a secure cookie', async () => {
  for (const key of [undefined, 'wrong', 'b'.repeat(64), {}, null]) {
    const result = await call('/_share/unlock', { method: 'POST', headers: { Origin: ORIGIN }, body: { key } });
    assert.equal(result.status, 403);
    assert.equal(result.headers['set-cookie'], undefined);
  }
  assert.equal((await call('/_share/unlock', { method: 'POST', headers: { Origin: ORIGIN }, body: '{bad' })).status, 400);
  assert.equal((await call('/_share/unlock', { method: 'POST', headers: { Origin: ORIGIN }, body: { key: KEY, extra: 'x'.repeat(4096) } })).status, 413);
  assert.equal((await call('/_share/unlock', { method: 'POST', headers: { Origin: ORIGIN }, chunked: true, body: { key: KEY, extra: 'x'.repeat(4096) } })).status, 413);
  for (const headers of [{}, { Origin: 'https://other.example' }, { Origin: ORIGIN, 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await call('/_share/unlock', { method: 'POST', headers, body: { key: KEY } })).status, 403);
  }
  const result = await call('/_share/unlock', { method: 'POST', headers: { Origin: ORIGIN }, body: { key: KEY } });
  assert.equal(result.status, 200);
  assert.match(result.headers['set-cookie'][0], /^__Host-hongson_share=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict$/);
  assert.ok(!result.text.includes(KEY) && !result.headers['set-cookie'][0].includes(KEY));
});

test('valid invitation proxies local app login, preserves CSP, and secures app cookies', async () => {
  const page = await call('/', { headers: { Cookie: gateCookie } });
  assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.equal(page.headers['referrer-policy'], 'no-referrer');
  assert.equal((await call('/api/health', { headers: { Cookie: gateCookie } })).status, 200);
  const login = await call('/api/login', { method: 'POST', headers: { Cookie: gateCookie, Origin: ORIGIN }, body: { username: 'teacher', password: 'Demo@2569' } });
  assert.equal(login.status, 200, login.text);
  assert.match(login.headers['set-cookie'][0], /; Secure(?:;|$)/);
  const appCookie = login.headers['set-cookie'][0].split(';')[0];
  const boot = await call('/api/bootstrap', { headers: { Cookie: `${gateCookie}; ${appCookie}` } });
  assert.equal(boot.status, 200);
  assert.equal(JSON.parse(boot.text).user.username, 'teacher');
});

test('gateway rejects foreign hosts, forged cookies, and unsafe cross-origin requests', async () => {
  for (const Host of ['localhost', `127.0.0.1:${port}`, 'other.example', 'share.test.example.evil']) {
    assert.equal((await call('/', { headers: { Host, Cookie: gateCookie } })).status, 403);
  }
  assert.equal((await call('/api/health', { headers: { Cookie: '__Host-hongson_share=' + 'b'.repeat(64) } })).status, 403);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const extra of [{}, { Origin: 'https://other.example' }, { Origin: ORIGIN, 'Sec-Fetch-Site': 'cross-site' }]) {
      const response = await call('/api/login', { method, headers: { Cookie: gateCookie, ...extra }, body: {} });
      assert.equal(response.status, 403, `${method} ${JSON.stringify(extra)}`);
    }
  }
});

test('proxy removes invitation cookie and untrusted forwarding headers before contacting loopback', async () => {
  let received;
  const upstream = http.createServer((req, res) => { received = req.headers; req.resume(); res.end('ok'); });
  const targetPort = await listen(upstream);
  const isolated = createShareGateway({ targetPort, shareKey: KEY, publicOrigin: ORIGIN });
  const requestPort = await listen(isolated);
  try {
    const unlocked = await call('/_share/unlock', { requestPort, method: 'POST', headers: { Origin: ORIGIN }, body: { key: KEY } });
    const cookie = unlocked.headers['set-cookie'][0].split(';')[0];
    assert.notEqual(cookie, gateCookie, 'each gateway must mint an independent cookie');
    assert.equal((await call('/api/health', { requestPort, headers: { Cookie: gateCookie } })).status, 403);
    const response = await call('/api/test', { requestPort, method: 'POST', body: {}, headers: {
      Cookie: `${cookie}; app_session=test`, Origin: ORIGIN, Referer: `${ORIGIN}/`,
      Forwarded: 'for=attacker;host=evil', 'X-Forwarded-For': 'attacker', 'X-Forwarded-Host': 'evil', 'X-Forwarded-Proto': 'http', 'X-Real-IP': 'attacker', 'CF-Connecting-IP': 'attacker',
    } });
    assert.equal(response.status, 200);
    assert.equal(received.host, `127.0.0.1:${targetPort}`);
    assert.equal(received.origin, `http://127.0.0.1:${targetPort}`);
    assert.equal(received.cookie, 'app_session=test');
    for (const name of ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'cf-connecting-ip', 'referer']) assert.equal(received[name], undefined, name);
  } finally { await close(isolated); await close(upstream); }
});
