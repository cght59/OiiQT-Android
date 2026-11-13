/* Shared client helpers: URL building, unified task model, status mapping */

export const STATUS = {
  downloading: { label: '下载中', color: 'var(--blue)' },
  queued:      { label: '排队中', color: 'var(--indigo)' },
  seeding:     { label: '做种中', color: 'var(--green)' },
  paused:      { label: '已暂停', color: 'var(--secondary)' },
  checking:    { label: '校验中', color: 'var(--orange)' },
  error:       { label: '错误',   color: 'var(--red)' },
  completed:   { label: '已完成', color: 'var(--teal)' },
};

export function normalizeServer(s) {
  let addr = String(s.address || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  let scheme = s.useHTTPS || /^https:/i.test(String(s.address)) ? 'https' : 'http';
  const hasPort = /\]:\d+$/.test(addr) || (/:\d+$/.test(addr) && (addr.match(/:/g) || []).length === 1);
  const port = Number(s.port) || (scheme === 'https' ? 443 : 80);
  const base = `${scheme}://${addr}${hasPort ? '' : ':' + port}`;
  const path = (s.rpcPath || '').trim() || (s.type === 'tr' ? '/transmission/rpc' : '/api/v2');
  const rpcPath = (path.startsWith('/') ? path : '/' + path).replace(/\/$/, '');
  // Backwards compatibility with OiiQT's persisted default.
  const apiPath = s.type === 'qb' && rpcPath === '/transmission/rpc' ? '/api/v2' : rpcPath;
  return { base, rpcPath, apiPath, rpcUrl: base + rpcPath, apiBase: base + apiPath, scheme, addr, port };
}

export function basicAuth(user, pass) {
  const bytes = new TextEncoder().encode(`${user || ''}:${pass || ''}`);
  let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
  return 'Basic ' + btoa(bin);
}

const QB_STATES = {
  metadl: 'downloading', allocating: 'downloading', downloading: 'downloading', dl: 'downloading',
  stalleddl: 'downloading', forceddl: 'downloading', forcedmetadl: 'downloading',
  queueddl: 'queued', queuedup: 'queued',
  uploading: 'seeding', stalledup: 'seeding', forcedup: 'seeding', up: 'seeding',
  pauseddl: 'paused', pausedup: 'paused', paused: 'paused',
  checkingdl: 'checking', checkingup: 'checking', checkingresumedata: 'checking', moving: 'checking',
  error: 'error', missingfiles: 'error', unregistered: 'error', unregisteredtorrent: 'error', unknown: 'error',
  completed: 'completed'
};
export const mapQBState = (s) => QB_STATES[String(s || '').trim().toLowerCase()] || 'paused';

export function mapTRStatus(code, errorCode, errorString) {
  if ((Number(errorCode) || 0) !== 0 || (errorString && String(errorString).trim())) return 'error';
  switch (Number(code)) {
    case 0: return 'paused';
    case 1: case 2: return 'checking';
    case 3: case 5: return 'queued';
    case 4: return 'downloading';
    case 6: return 'seeding';
    default: return 'paused';
  }
}

export function splitTags(v) {
  if (Array.isArray(v)) return [...new Set(v.map(x => String(x).trim()).filter(Boolean))];
  return [...new Set(String(v || '').split(/[,;\n]/).map(x => x.trim()).filter(Boolean))];
}
export function trackerHost(url) {
  if (!url) return '';
  try { return new URL(url.includes('://') ? url : 'http://' + url).hostname; }
  catch { return String(url).replace(/^https?:\/\//, '').split('/')[0]; }
}

/** serverId + hash is the composite key, matching OiiQT's TorrentTask.id */
export function makeTask(server, t) {
  const o = Object.assign({
    serverId: server.id, serverName: server.name, serverType: server.type,
    hash: '', name: '', progress: 0, size: 0, dlSpeed: 0, upSpeed: 0, eta: -1,
    status: 'paused', error: '', tracker: '', savePath: '', category: '', tags: [],
    downloaded: 0, uploaded: 0, addedOn: 0, completedOn: 0, seedingTime: 0,
    ratio: 0, numSeeds: 0, totalSeeds: 0, numPeers: 0, totalPeers: 0,
    isSequential: false, isFirstLastPiecePriority: false
  }, t);
  o.id = server.id + '_' + o.hash;
  return o;
}

export function formPair(obj) {
  return Object.entries(obj).map(([name, value]) => ({ name, value: String(value) }));
}
export function encodeQuery(obj) {
  return new URLSearchParams(Object.entries(obj).map(([k, v]) => [k, String(v)])).toString();
}

/** Fetch with one automatic re-login on HTTP 403 (qBittorrent SID expired). */
export async function withRelogin(fn, login) {
  try { return await fn(); }
  catch (e) {
    if (e && e.status === 403) { await login(); return await fn(); }
    throw e;
  }
}
