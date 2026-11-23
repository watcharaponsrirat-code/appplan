import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = '__Host-hongson_share';
const MAX_UNLOCK_BYTES = 4096;
const UNSAFE = method => !['GET', 'HEAD', 'OPTIONS'].includes(method);
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const GATE_CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const LANDING = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>ลิงก์เชิญ Hongson Plan</title>
<style>body{margin:0;background:#f3f7f6;color:#163a33;font-family:system-ui,sans-serif;line-height:1.8}main{max-width:560px;margin:12vh auto;padding:32px;background:white;border-radius:20px}h1{font-size:26px}p{color:#3f5b54}@media(max-width:620px){main{margin:24px;padding:24px}}</style></head>
<body><main><h1>Hongson Plan</h1><p id="share-status" role="status">กำลังตรวจสอบลิงก์เชิญ…</p><p>โปรดเปิดลิงก์เชิญฉบับเต็มที่ผู้ดูแลส่งให้ ลิงก์นี้ใช้ได้ขณะที่เครื่องของผู้ดูแลเปิดระบบแชร์อยู่</p><noscript>กรุณาเปิด JavaScript เพื่อใช้ลิงก์เชิญ</noscript></main><script src="/_share/unlock.js" defer></script></body></html>`;
const UNLOCK_SCRIPT = `(() => {
  const status = document.getElementById('share-status');
  const key = new URLSearchParams(location.hash.slice(1)).get('key');
  history.replaceState(null, '', location.pathname + location.search);
  if (!key) { status.textContent = 'ต้องใช้ลิงก์เชิญฉบับเต็มเพื่อเข้าสู่ระบบ'; return; }
  fetch('/_share/unlock', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) })
    .then(response => { if (!response.ok) throw new Error('invalid'); location.replace('/'); })
    .catch(() => { status.textContent = 'ลิงก์เชิญไม่ถูกต้องหรือหมดอายุ กรุณาขอลิงก์ล่าสุดจากผู้ดูแล'; });
})();`;

function privateHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function reply(req, res, status, body, type = 'text/plain; charset=utf-8') {
  privateHeaders(res);
  res.setHeader('Content-Security-Policy', GATE_CSP);
  res.writeHead(status, { 'Content-Type': type });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function matchesHex(value, expected) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
    && timingSafeEqual(Buffer.from(value, 'hex'), expected);
}

function cleanHeaders(headers) {
  const blocked = new Set(HOP_HEADERS);
  for (const name of String(headers.connection || '').split(',')) blocked.add(name.trim().toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !blocked.has(name)
    && !/^(forwarded|x-forwarded-.*|x-real-ip|true-client-ip|cf-.*)$/i.test(name)));
}

async function readUnlock(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) {
    throw Object.assign(new Error('invalid content type'), { status: 415 });
  }
  if (Number(req.headers['content-length']) > MAX_UNLOCK_BYTES) {
    req.resume();
    throw Object.assign(new Error('body too large'), { status: 413 });
  }
  const body = await new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    const cleanup = () => { req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('aborted', onAborted); };
    const onError = error => { cleanup(); reject(error); };
    const onAborted = () => onError(new Error('request aborted'));
    const onData = chunk => {
      length += chunk.length;
      if (length > MAX_UNLOCK_BYTES) {
        cleanup();
        req.resume();
        reject(Object.assign(new Error('body too large'), { status: 413 }));
      } else chunks.push(chunk);
    };
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks).toString('utf8')); };
    req.on('data', onData); req.once('end', onEnd); req.once('error', onError); req.once('aborted', onAborted);
  });
  try { return JSON.parse(body); }
  catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
}

/** A loopback reverse proxy protected by a fragment-based invitation and secure cookie. */
export function createShareGateway({ targetPort, shareKey, publicOrigin } = {}) {
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) throw new TypeError('targetPort must be a valid port');
  if (typeof shareKey !== 'string' || !/^[a-f0-9]{64}$/i.test(shareKey)) throw new TypeError('shareKey must contain 32 random bytes encoded as hex');
  let origin;
  try { origin = new URL(publicOrigin); } catch { throw new TypeError('publicOrigin must be an HTTPS origin'); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new TypeError('publicOrigin must be an HTTPS origin');
  }
  const keyBytes = Buffer.from(shareKey, 'hex');
  const cookieBytes = randomBytes(32);
  const cookieValue = cookieBytes.toString('hex');
  const targetHost = `127.0.0.1:${targetPort}`;
  const targetOrigin = `http://${targetHost}`;

  const server = http.createServer(async (req, res) => {
    privateHeaders(res);
    if (req.headers.host !== origin.host || !req.url?.startsWith('/') || req.url.startsWith('//')) {
      return reply(req, res, 403, 'ไม่อนุญาตให้เข้าถึง');
    }
    if (UNSAFE(req.method) && (req.headers.origin !== origin.origin || req.headers['sec-fetch-site'] === 'cross-site')) {
      return reply(req, res, 403, 'ไม่อนุญาตให้เข้าถึง');
    }
    let path;
    try { path = new URL(req.url, origin.origin).pathname; }
    catch { return reply(req, res, 400, 'คำขอไม่ถูกต้อง'); }

    if (path === '/_share/unlock.js' && ['GET', 'HEAD'].includes(req.method)) {
      return reply(req, res, 200, UNLOCK_SCRIPT, 'text/javascript; charset=utf-8');
    }
    if (path === '/_share/unlock' && req.method === 'POST') {
      try {
        const input = await readUnlock(req);
        if (!matchesHex(input?.key, keyBytes)) return reply(req, res, 403, 'ลิงก์เชิญไม่ถูกต้อง');
        res.setHeader('Set-Cookie', `${COOKIE_NAME}=${cookieValue}; Path=/; HttpOnly; Secure; SameSite=Strict`);
        return reply(req, res, 200, '{"ok":true}', 'application/json; charset=utf-8');
      } catch (error) {
        return reply(req, res, error.status || 400, 'คำขอไม่ถูกต้อง');
      }
    }

    const cookies = String(req.headers.cookie || '').split(';').map(item => item.trim());
    const gateCookie = cookies.find(item => item.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
    if (!matchesHex(gateCookie, cookieBytes)) {
      if (path === '/' && ['GET', 'HEAD'].includes(req.method)) return reply(req, res, 200, LANDING, 'text/html; charset=utf-8');
      return reply(req, res, 403, 'โปรดเปิดลิงก์เชิญฉบับเต็ม');
    }

    const headers = cleanHeaders(req.headers);
    headers.host = targetHost;
    const appCookies = cookies.filter(item => item && !item.startsWith(`${COOKIE_NAME}=`)).join('; ');
    if (appCookies) headers.cookie = appCookies;
    else delete headers.cookie;
    if (headers.origin === origin.origin) headers.origin = targetOrigin;
    delete headers.referer;
    const upstream = http.request({ hostname: '127.0.0.1', port: targetPort, method: req.method, path: req.url, headers }, response => {
      const responseHeaders = cleanHeaders(response.headers);
      if (responseHeaders['set-cookie']) {
        responseHeaders['set-cookie'] = responseHeaders['set-cookie'].map(cookie => /;\s*Secure(?:;|$)/i.test(cookie) ? cookie : `${cookie}; Secure`);
      }
      for (const [name, value] of Object.entries(responseHeaders)) if (value !== undefined) res.setHeader(name, value);
      privateHeaders(res);
      res.writeHead(response.statusCode || 502);
      response.on('error', () => res.destroy());
      response.pipe(res);
    });
    upstream.setTimeout(30000, () => upstream.destroy(new Error('upstream timeout')));
    upstream.on('error', () => {
      if (!res.headersSent) reply(req, res, 502, 'ระบบยังไม่พร้อมใช้งาน กรุณาลองใหม่');
      else res.destroy();
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
    req.pipe(upstream);
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  const rejectUpgrade = (_req, socket) => { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); };
  server.on('upgrade', rejectUpgrade);
  server.on('connect', rejectUpgrade);
  return server;
}
