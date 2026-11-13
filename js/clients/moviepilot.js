/* MoviePilot v1 API — discovery, media search, resource results, add download.
 * Auth: MoviePilot deployments differ, so we retry Bearer / X-API-KEY /
 * ?apikey= / ?token= exactly like the original Swift client. */
import { request } from '../transport.js';

const AUTH_MODES = ['bearer', 'apikey-header', 'apikey-query', 'token-query'];
export const MP_SOURCES = [
  { key: 'douban_movies', name: '豆瓣电影', path: 'api/v1/recommend/douban_movies' },
  { key: 'douban_tvs', name: '豆瓣剧集', path: 'api/v1/recommend/douban_tvs' },
  { key: 'douban_showing', name: '正在热映', path: 'api/v1/recommend/douban_showing' },
  { key: 'douban_movie_top250', name: '豆瓣 Top250', path: 'api/v1/recommend/douban_movie_top250' },
  { key: 'douban_tv_animation', name: '豆瓣动画', path: 'api/v1/recommend/douban_tv_animation' },
  { key: 'tmdb_trending', name: 'TMDB 趋势', path: 'api/v1/recommend/tmdb_trending' },
  { key: 'tmdb_movies', name: 'TMDB 电影', path: 'api/v1/recommend/tmdb_movies' },
  { key: 'tmdb_tvs', name: 'TMDB 剧集', path: 'api/v1/recommend/tmdb_tvs' },
  { key: 'bangumi_calendar', name: '番剧日历', path: 'api/v1/recommend/bangumi_calendar' }
];

function normalizeBase(u) {
  let s = String(u || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  return s;
}
function buildURL(inst, path, query = {}, mode = 'bearer') {
  const base = normalizeBase(inst.address);
  const q = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)); });
  if (mode === 'apikey-query') q.set('apikey', inst.token || '');
  if (mode === 'token-query') q.set('token', inst.token || '');
  return base + '/' + String(path).replace(/^\/+/, '') + (q.toString() ? '?' + q.toString() : '');
}
function authHeaders(inst, mode) {
  const h = { Accept: 'application/json' };
  if (mode === 'bearer') h.Authorization = 'Bearer ' + (inst.token || '');
  if (mode === 'apikey-header') h['X-API-KEY'] = inst.token || '';
  return h;
}

async function call(inst, { path, query = {}, method = 'GET', body = null }) {
  let last;
  for (const mode of AUTH_MODES) {
    try {
      const r = await request({
        url: buildURL(inst, path, query, mode),
        method, body, timeout: 20000,
        headers: Object.assign(authHeaders(inst, mode), body ? { 'Content-Type': 'application/json' } : {}),
        jar: 'mp-' + inst.id, insecure: !!inst.allowInsecureSSL
      });
      if (r.status === 401 || r.status === 403) { last = new Error('MoviePilot 认证失败，请检查访问令牌'); continue; }
      if (r.status < 200 || r.status >= 300) { last = new Error(`MoviePilot HTTP ${r.status}`); continue; }
      return r.text ? r.json() : {};
    } catch (e) { last = e; }
  }
  throw last || new Error('MoviePilot 连接失败');
}
function unwrap(j) {
  if (Array.isArray(j)) return j;
  if (j && Array.isArray(j.data)) return j.data;
  if (j && j.data && Array.isArray(j.data.list)) return j.data.list;
  if (j && Array.isArray(j.list)) return j.list;
  if (j && j.data && typeof j.data === 'object') return [j.data];
  return [];
}

export function posterOf(item) {
  const p = item.poster_path || item.posterPath || item.poster || '';
  if (/^https?:\/\//.test(p)) return p;
  if (p.startsWith('/')) return 'https://image.tmdb.org/t/p/w500' + p;
  return p;
}
export function titleOf(item) {
  return item.title || item.name || item.original_title || item.original_name || '未命名';
}
export function yearOf(item) {
  return item.year || (item.release_date || item.first_air_date || '').slice(0, 4) || '';
}
export function mediaIdOf(item) {
  return item.media_id || item.mediaID || item.tmdb_id || item.douban_id || item.bangumi_id || item.id || '';
}
export function mediaTypeOf(item) {
  const t = String(item.type || item.mtype || '').toLowerCase();
  if (t.includes('tv') || t.includes('剧') || t.includes('番')) return '电视剧';
  return '电影';
}

export const MoviePilot = {
  async test(inst) {
    const r = await call(inst, { path: 'api/v1/user/current' });
    return r && (r.data || r);
  },
  async sources(inst) {
    try { return unwrap(await call(inst, { path: 'api/v1/recommend/source' })); }
    catch { return []; }
  },
  async discover(inst, source, page = 1) {
    return unwrap(await call(inst, { path: source.path, query: { page, count: 20 } }));
  },
  async mediaSearch(inst, title, page = 1) {
    return unwrap(await call(inst, {
      path: 'api/v1/media/search', query: { title, type: 'media', page, count: 20 }
    }));
  },
  async detail(inst, item) {
    const q = { type_name: mediaTypeOf(item), title: titleOf(item), year: yearOf(item) };
    const j = await call(inst, { path: 'api/v1/media/' + mediaIdOf(item), query: q });
    return (j && j.data) || j || {};
  },
  async resources(inst, item) {
    const q = {
      mtype: mediaTypeOf(item), area: 'title', title: titleOf(item),
      year: yearOf(item), season: item.season || ''
    };
    const j = await call(inst, { path: 'api/v1/search/media/' + mediaIdOf(item), query: q });
    return unwrap(j);
  },
  async clients(inst) {
    try { return unwrap(await call(inst, { path: 'api/v1/download/clients' })); }
    catch { return []; }
  },
  async addDownload(inst, torrentInfo, opts = {}) {
    const body = { torrent_in: torrentInfo };
    if (opts.downloader) body.downloader = opts.downloader;
    if (opts.savePath) body.save_path = opts.savePath;
    return call(inst, { path: 'api/v1/download/add', method: 'POST', body: JSON.stringify(body) });
  }
};
