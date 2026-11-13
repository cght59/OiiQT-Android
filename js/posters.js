/* Optional TMDB poster matching (bring your own API key). */
import { request } from './transport.js';
import { runtime, state } from './store.js';

const TMDB_IMG = 'https://image.tmdb.org/t/p/w342';
let inflight = false;

function cleanTitle(name = '') {
  return String(name)
    .replace(/\.[A-Za-z0-9]+$/, '')
    .replace(/[._]/g, ' ')
    .replace(/\b(2160[Pp]|1080[PpIi]|720[Pp]|4[Kk]|UHD|HDR|DV|WEB[- ]?DL|BluRay|BDRip|x264|x265|H\.?26[45]|AAC|FLAC|DDP?|TrueHD|Atmos|10bit|SDR|REMUX|GB|NF|AMZN|DSNP|HMAX| complete| season|S\d{1,2}(E\d{1,2})?|第[一二三四五六七八九十\d]+季)\b.*$/i, '')
    .replace(/[\s\-]+/g, ' ')
    .trim();
}
function guessYear(name = '') {
  const m = String(name).match(/\b(19|20)\d{2}\b/g);
  if (!m) return '';
  return m.find(y => Number(y) >= 1980 && Number(y) <= new Date().getFullYear() + 2) || '';
}
function isTV(name = '') { return /\bS\d{1,2}(E\d{1,2})?\b|第[一二三四五六七八九十\d]+季|Season\s*\d/i.test(name); }

/** Match posters for tasks, up to `limit` new lookups per call. */
export async function matchPosters(tasks, limit = 6) {
  const key = (state.settings.tmdbKey || '').trim();
  if (!key || inflight) return 0;
  inflight = true;
  let done = 0;
  try {
    for (const t of tasks) {
      if (done >= limit) break;
      if (runtime.posters[t.name] !== undefined) continue;
      const q = cleanTitle(t.name);
      if (q.length < 2) { runtime.posters[t.name] = ''; continue; }
      const kind = isTV(t.name) ? 'tv' : 'movie';
      const year = guessYear(t.name);
      const params = new URLSearchParams({ api_key: key, query: q, language: 'zh-CN', page: '1' });
      if (year && kind === 'movie') params.set('year', year);
      try {
        const r = await request({
          url: `https://api.themoviedb.org/3/search/${kind}?${params}`,
          method: 'GET', timeout: 12000, jar: 'tmdb', headers: { Accept: 'application/json' }
        });
        const j = r.json();
        const hit = (j.results || []).find(x => x.poster_path);
        runtime.posters[t.name] = hit ? TMDB_IMG + hit.poster_path : '';
        done++;
      } catch { runtime.posters[t.name] = ''; }
    }
  } finally { inflight = false; }
  return done;
}
export function posterFor(task) { return runtime.posters[task.name] || ''; }
