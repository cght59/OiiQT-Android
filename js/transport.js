/*
 * Transport layer.
 * Browsers cannot call qBittorrent / Transmission RPC directly because those
 * servers send no CORS headers. We support three transports:
 *   native - CapacitorHttp patched fetch inside the APK (no CORS at all)
 *   proxy  - same-origin POST /proxy handled by the bundled Node server
 *   direct - plain fetch, works only if the downloader/proxy allows CORS
 */
import { state } from './store.js';

const UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
let detected = null;

/*
 * Inside the APK, CapacitorHttp patches window.fetch and bypasses CORS, but it
 * does not reliably persist Set-Cookie between calls. qBittorrent gates every
 * /api/v2 call on the SID cookie, so we keep an explicit per-server jar here.
 */
const nativeJars = new Map();
function nativeCookieHeader(key) {
  const jar = nativeJars.get(key);
  return jar && jar.size ? [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ') : '';
}
function storeNativeCookies(key, headers) {
  const lines = Object.keys(headers)
    .filter(k => k.toLowerCase() === 'set-cookie')
    .map(k => headers[k]);
  if (!lines.length) return;
  const jar = nativeJars.get(key) || new Map();
  // Split a possibly combined Set-Cookie header without breaking "Expires=Wed, ...".
  lines.join(',').split(/,(?=\s*[^;,=\s]+\s*=)/).forEach(seg => {
    const first = seg.split(';')[0].trim();
    const i = first.indexOf('=');
    if (i <= 0) return;
    const name = first.slice(0, i).trim();
    const value = first.slice(i + 1).trim();
    if (/^(path|domain|expires|max-age|samesite|secure|httponly|priority|partitioned)$/i.test(name)) return;
    if (!value || /^deleted$/i.test(value)) jar.delete(name);
    else jar.set(name, value);
  });
  nativeJars.set(key, jar);
}

export function isNative() {
  try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
  catch { return false; }
}
export function proxyURL() {
  const custom = String(state.settings.proxyBase || '').trim();
  if (custom) {
    return /^https?:\/\//i.test(custom) ? custom : new URL(custom, document.baseURI).href;
  }
  return new URL('proxy', document.baseURI).href;
}

async function probeProxy() {
  try {
    const r = await fetch(proxyURL(), { method: 'GET', headers: { Accept: 'application/json' } });
    if (!r.ok) return false;
    const j = await r.json();
    return j && j.oiiqt === true;
  } catch { return false; }
}

export async function currentMode() {
  const pref = state.settings.transport;
  if (pref && pref !== 'auto') return pref;
  if (isNative()) return 'native';
  if (detected === null) detected = await probeProxy();
  return detected ? 'proxy' : 'direct';
}
export function invalidateMode() { detected = null; }

/** Reset the server-side cookie jar (e.g. after changing qB credentials). */
export async function resetJar(jar) {
  if (!jar) return;
  const mode = await currentMode();
  if (mode === 'native') { nativeJars.delete(jar); return; }
  if (mode !== 'proxy') return;
  try {
    await fetch(proxyURL(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset', jar })
    });
  } catch { /* ignore */ }
}

function formToUrlEncoded(form) {
  const p = new URLSearchParams();
  form.forEach(f => { if (f.filename === undefined) p.append(f.name, String(f.value)); });
  return p.toString();
}
function formToFormData(form) {
  const fd = new FormData();
  form.forEach(f => {
    if (f.filename !== undefined) {
      const bin = atob(f.base64 || '');
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      fd.append(f.name, new Blob([arr], { type: f.contentType || 'application/octet-stream' }), f.filename);
    } else fd.append(f.name, String(f.value));
  });
  return fd;
}

/**
 * @param {object} d descriptor
 *   url, method, headers, body(string|null), form(array|null),
 *   jar, insecure, timeout(ms)
 * @returns {Promise<{status:number, headers:object, text:string, json:()=>any}>}
 */
export async function request(d) {
  const mode = await currentMode();
  const headers = Object.assign({ 'User-Agent': UA, 'Accept': '*/*' }, d.headers || {});
  const timeout = d.timeout || 25000;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);

  try {
    if (mode === 'proxy') {
      const payload = {
        url: d.url, method: d.method || 'GET', headers,
        body: d.body ?? null, form: d.form ?? null,
        jar: d.jar || '', insecure: !!d.insecure, timeout
      };
      const r = await fetch(proxyURL(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: ctl.signal
      });
      const env = await r.json().catch(() => ({}));
      if (!r.ok || env.ok === false) {
        const err = new Error(env.error || `代理请求失败 (HTTP ${r.status})`);
        err.status = env.status || r.status; err.proxy = true;
        throw err;
      }
      return wrap(env.status, env.headers || {}, env.body ?? '');
    }

    // direct / native
    if (mode === 'native' && d.jar) {
      const ck = nativeCookieHeader(d.jar);
      if (ck) headers['Cookie'] = headers['Cookie'] ? `${headers['Cookie']}; ${ck}` : ck;
    }
    const init = { method: d.method || 'GET', headers, signal: ctl.signal, credentials: 'include' };
    if (d.body != null) init.body = d.body;
    else if (d.form) {
      const hasFile = d.form.some(f => f.filename !== undefined);
      if (hasFile) { init.body = formToFormData(d.form); delete headers['Content-Type']; }
      else { init.body = formToUrlEncoded(d.form); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    }
    const r = await fetch(d.url, init);
    const hs = {};
    r.headers.forEach((v, k) => { hs[k] = v; });
    if (mode === 'native' && d.jar) storeNativeCookies(d.jar, hs);
    return wrap(r.status, hs, await r.text());
  } catch (e) {
    if (e.name === 'AbortError') { const x = new Error('请求超时'); x.timeout = true; throw x; }
    if (e instanceof TypeError && mode === 'direct') {
      const x = new Error('连接失败：目标服务器未允许跨域 (CORS)。请改用「反向代理」模式或安装 APK。');
      x.cors = true; throw x;
    }
    throw e;
  } finally { clearTimeout(timer); }
}

function wrap(status, headers, text) {
  return {
    status, headers, text,
    header(name) {
      const k = Object.keys(headers).find(x => x.toLowerCase() === name.toLowerCase());
      return k ? headers[k] : null;
    },
    json() { try { return JSON.parse(text); } catch { throw new Error('返回内容不是有效 JSON: ' + String(text).slice(0, 120)); } }
  };
}

/** Read a File/Blob as base64 (without the data: prefix). */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
