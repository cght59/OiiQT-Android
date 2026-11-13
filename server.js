#!/usr/bin/env node
/*
 * OiiQT for Android — zero-dependency static host + CORS-busting reverse proxy.
 *
 *   node server.js                 # http://0.0.0.0:8787
 *   PORT=9000 HOST=127.0.0.1 node server.js
 *
 * Why: qBittorrent WebUI and Transmission RPC send no CORS headers, so a
 * browser PWA cannot call them directly. /proxy forwards the exact request
 * server-side, keeps a per-server SID cookie jar, and returns a JSON envelope.
 * Deploy this on the same machine as (or next to) your downloader / NAS.
 */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 24 * 1024 * 1024; // 24 MB upload cap
// Optional TLS: Android Chrome only offers full PWA install / service worker on HTTPS.
//   SSL_KEY=./key.pem SSL_CERT=./cert.pem node server.js
// (or put an HTTPS reverse proxy such as Caddy / Nginx in front)
const SSL_KEY = process.env.SSL_KEY || '';
const SSL_CERT = process.env.SSL_CERT || '';
const TLS = !!(SSL_KEY && SSL_CERT && fs.existsSync(SSL_KEY) && fs.existsSync(SSL_CERT));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};

/* ---------- static files ---------- */
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(ROOT, '.' + rel);
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback
      const idx = path.join(ROOT, 'index.html');
      if (fs.existsSync(idx)) {
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
        fs.createReadStream(idx).pipe(res);
      } else { res.writeHead(404); res.end('Not found'); }
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=3600',
      'Content-Length': st.size
    });
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------- per-server cookie jar (qBittorrent SID) ---------- */
const jars = new Map();
function jarFor(key) {
  if (!jars.has(key)) jars.set(key, new Map());
  return jars.get(key);
}
function storeCookies(key, setCookie) {
  if (!key || !setCookie) return;
  const jar = jarFor(key);
  (Array.isArray(setCookie) ? setCookie : [setCookie]).forEach(line => {
    const first = String(line).split(';')[0];
    const i = first.indexOf('=');
    if (i > 0) jar.set(first.slice(0, i).trim(), first.slice(i + 1).trim());
  });
}
function cookieHeader(key) {
  const jar = jars.get(key);
  if (!jar || !jar.size) return '';
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/* ---------- multipart form-data builder ---------- */
function buildMultipart(form) {
  const boundary = '----OiiQTForm' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const chunks = [];
  const CRLF = '\r\n';
  for (const f of form) {
    let head = `--${boundary}${CRLF}Content-Disposition: form-data; name="${String(f.name).replace(/"/g, '')}"`;
    if (f.filename !== undefined) {
      head += `; filename="${String(f.filename).replace(/"/g, '')}"`;
      head += `${CRLF}Content-Type: ${f.contentType || 'application/octet-stream'}`;
    }
    chunks.push(Buffer.from(head + CRLF + CRLF, 'utf8'));
    chunks.push(f.filename !== undefined ? Buffer.from(f.base64 || '', 'base64') : Buffer.from(String(f.value ?? ''), 'utf8'));
    chunks.push(Buffer.from(CRLF, 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--${CRLF}`, 'utf8'));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length', 'host', 'accept-encoding']);

/* ---------- one upstream request (with redirect following) ---------- */
function upstream(p, redirects = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(p.url); } catch { return reject(new Error('无效的目标 URL')); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new Error('仅支持 http / https'));

    const headers = {};
    Object.entries(p.headers || {}).forEach(([k, v]) => {
      if (v != null && !HOP.has(k.toLowerCase())) headers[k] = String(v);
    });
    if (p.body != null) {
      // body is a plain string (JSON / form-urlencoded) supplied by the client
    } else if (Array.isArray(p.form)) {
      if (p.form.some(f => f.filename !== undefined)) {
        const mp = buildMultipart(p.form);
        headers['Content-Type'] = mp.contentType;
        p = { ...p, _buffer: mp.body };
      } else {
        const usp = new URLSearchParams();
        p.form.forEach(f => usp.append(f.name, String(f.value ?? '')));
        p = { ...p, _buffer: Buffer.from(usp.toString(), 'utf8') };
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
    }
    const ck = cookieHeader(p.jar);
    if (ck) headers['Cookie'] = ck;
    delete headers['Cookie2'];

    let payload = null;
    if (p._buffer) payload = p._buffer;
    else if (p.body != null) payload = Buffer.from(String(p.body), 'utf8');
    if (payload) headers['Content-Length'] = String(payload.length);

    const mod = u.protocol === 'https:' ? https : http;
    const opts = {
      protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: (p.method || 'GET').toUpperCase(), headers,
      timeout: Math.min(Number(p.timeout) || 25000, 180000),
      agent: u.protocol === 'https:'
        ? new https.Agent({ rejectUnauthorized: !p.insecure, keepAlive: false })
        : undefined
    };
    const req = mod.request(opts, (r) => {
      const chunks = [];
      let len = 0;
      r.on('data', c => { len += c.length; if (len <= MAX_BODY) chunks.push(c); });
      r.on('end', () => {
        const status = r.statusCode || 0;
        storeCookies(p.jar, r.headers['set-cookie']);
        const outHeaders = {};
        Object.entries(r.headers).forEach(([k, v]) => {
          if (HOP.has(k.toLowerCase()) || k.toLowerCase() === 'set-cookie') return;
          outHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v);
        });
        if (status >= 300 && status < 400 && r.headers.location && redirects < 3) {
          let next;
          try { next = new URL(r.headers.location, u).href; } catch { next = null; }
          if (next) { upstream({ ...p, url: next }, redirects + 1).then(resolve, reject); return; }
        }
        resolve({ ok: true, status, headers: outHeaders, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('timeout', () => req.destroy(new Error('上游请求超时')));
    req.on('error', (e) => reject(e));
    if (payload) req.write(payload);
    req.end();
  });
}

/* ---------- HTTP server ---------- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let len = 0;
    req.on('data', c => {
      len += c.length;
      if (len > MAX_BODY) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(new Error('请求体不是合法 JSON')); } });
    req.on('error', reject);
  });
}
function json(res, code, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length, 'Cache-Control': 'no-store' });
  res.end(b);
}

const handler = async (req, res) => {
  // Allow a PWA hosted elsewhere (or an APK) to use this proxy remotely.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (u.pathname === '/proxy' || u.pathname.endsWith('/proxy')) {
    if (req.method === 'GET') return json(res, 200, { oiiqt: true, name: 'OiiQT proxy', version: 1 });
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: '仅支持 GET / POST' });
    try {
      const p = await readBody(req);
      if (p.action === 'reset') { jars.delete(p.jar); return json(res, 200, { ok: true, status: 200, headers: {}, body: '' }); }
      if (!p.url) return json(res, 200, { ok: false, error: '缺少 url' });
      const out = await upstream(p);
      return json(res, 200, out);
    } catch (e) {
      return json(res, 200, { ok: false, status: 0, error: e.message || '代理转发失败' });
    }
  }
  if (u.pathname === '/health') return json(res, 200, { ok: true });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, u.pathname);
};

const server = TLS
  ? https.createServer({ key: fs.readFileSync(SSL_KEY), cert: fs.readFileSync(SSL_CERT) }, handler)
  : http.createServer(handler);

server.listen(PORT, HOST, () => {
  const scheme = TLS ? 'https' : 'http';
  console.log('');
  console.log('  OiiQT for Android');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  本机访问:   ${scheme}://localhost:${PORT}`);
  if (HOST === '0.0.0.0') console.log(`  手机访问:   ${scheme}://<这台机器的局域网IP>:${PORT}`);
  console.log('  反向代理:   POST /proxy   (自动绕过 CORS / 维护 SID Cookie)');
  if (!TLS) console.log('  提示: 完整 PWA 安装需要 HTTPS，可设置 SSL_KEY / SSL_CERT 或前置 HTTPS 反代');
  console.log('  按 Ctrl+C 停止');
  console.log('');
});
