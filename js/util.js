/* Shared helpers: icons, formatters, DOM, toast, bottom sheets */

const PATHS = {
  chart: '<path d="M4 19V11M10 19V5M16 19v-6M22 19H2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  rss: '<path d="M4 11a9 9 0 0 1 9 9M4 5a15 15 0 0 1 15 15"/><circle cx="5" cy="19" r="1.6" fill="currentColor" stroke="none"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  sort: '<path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3"/>',
  check: '<path d="m4 12.5 5 5L20 6.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.7 2.7L16 9.5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  arrowDown: '<path d="M12 4v15m0 0-5-5m5 5 5-5"/>',
  arrowUp: '<path d="M12 20V5m0 0-5 5m5-5 5 5"/>',
  leaf: '<path d="M20 4C10 4 4 8 4 15a5 5 0 0 0 5 5c7 0 11-6 11-16Z"/><path d="M4 20c3-5 7-8 12-10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.3l3.4 2"/>',
  file: '<path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9Z"/><path d="M13 3v6h6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  link: '<path d="M10 13a4 4 0 0 0 5.7.3l2.6-2.6a4 4 0 0 0-5.7-5.7L11 6.6"/><path d="M14 11a4 4 0 0 0-5.7-.3l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.6-1.6"/>',
  ratio: '<path d="M3 8h13m0 0-4-4m4 4-4 4M21 16H8m0 0 4-4m-4 4 4 4"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  play: '<path d="M7 4.5 19 12 7 19.5Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v6M14 11v6"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 9-12h-7Z"/>',
  gauge: '<path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="m13.4 10.6 4-4"/><path d="M4.2 18a9 9 0 1 1 15.6 0"/>',
  tag: '<path d="m3 12 9 9 9-9-9-9H3Z"/><circle cx="8" cy="8" r="1.2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  more: '<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  edit: '<path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10Z"/><path d="m14 7 3 3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6Z"/><path d="m9 12 2 2 4-4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  wifiOff: '<path d="M3 3l18 18M8.5 15.5a5 5 0 0 1 7 0M5 12a10 10 0 0 1 4-2.4M19 12a10 10 0 0 0-3-2.2M2 8.5A15 15 0 0 1 7 6M22 8.5A15 15 0 0 0 17 6"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>',
  disk: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 14h18"/><circle cx="7.5" cy="10" r="1" fill="currentColor" stroke="none"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8Z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 3-3 4 4"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9Z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.8"/><path d="M9.5 5.3A9 9 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-2.2 3.2M6.2 6.8A13 13 0 0 0 2 12c1 2.5 5 7 10 7 1.3 0 2.5-.3 3.6-.8"/>',
  upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  download: '<path d="M12 4v12m0 0-5-5m5 5 5-5M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5M3 17l9 5 9-5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z"/>',
  magnet: '<path d="M5 4v8a7 7 0 0 0 14 0V4h-4v8a3 3 0 0 1-6 0V4Z"/><path d="M5 8h4M15 8h4"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  swap: '<path d="M4 8h13m0 0-4-4m4 4-4 4M20 16H7m0 0 4-4m-4 4 4 4"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
};

export function ico(name, size = 18, extra = '') {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra} aria-hidden="true">${PATHS[name] || PATHS.info}</svg>`;
}
export function circleIco(name, color, size = 16) {
  return `<span class="stat-icon" style="background:${color}">${ico(name, size)}</span>`;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
export function fmtBytes(n) {
  n = Number(n) || 0;
  if (n === 0) return '0 B';
  const neg = n < 0; n = Math.abs(n);
  let i = 0;
  while (n >= 1024 && i < UNITS.length - 1) { n /= 1024; i++; }
  const v = i === 0 ? String(Math.round(n)) : n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
  return (neg ? '-' : '') + v + ' ' + UNITS[i];
}
export const fmtSpeed = (n) => fmtBytes(n) + '/s';
export function fmtStorage(n) {
  n = Number(n) || 0;
  if (n >= 1e15) return (n / 1e15).toFixed(n / 1e15 >= 100 ? 0 : n / 1e15 >= 10 ? 1 : 2) + ' PB';
  if (n >= 1e12) return (n / 1e12).toFixed(n / 1e12 >= 100 ? 0 : n / 1e12 >= 10 ? 1 : 2) + ' TB';
  return fmtBytes(n);
}
export function fmtDuration(sec) {
  sec = Number(sec) || 0;
  if (sec < 0 || sec >= 8640000) return '∞';
  if (sec < 60) return sec + ' 秒';
  const m = Math.floor(sec / 60), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return `${d}天${h ? h + '小时' : ''}${mm && !h ? mm + '分' : ''}`;
  if (h > 0) return `${h}小时${mm ? mm + '分' : ''}`;
  return `${mm}分`;
}
export const fmtPct = (p) => `${Math.round((Number(p) || 0) * 100)}%`;
export const fmtRatio = (r) => (Number(r) || 0).toFixed(2);
export function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts) * 1000);
  if (isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function fmtRelative(ts) {
  if (!ts) return '—';
  const diff = Date.now() / 1000 - Number(ts);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  return Math.floor(diff / 86400) + ' 天前';
}
export function hostOf(url) {
  try { return new URL(url.includes('://') ? url : 'http://' + url).hostname; } catch { return String(url || '').replace(/^https?:\/\//, '').split('/')[0]; }
}
export function detectResolution(name = '') {
  if (/\b(2160[pP]|4[kK]|UHD)\b/.test(name)) return '4K';
  if (/\b(1080[pPiI]|FHD|FullHD)\b/.test(name)) return '1080p';
  if (/\b(720[pP]|HD)\b/.test(name)) return '720p';
  return '';
}
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));

/* ---------- toast ---------- */
let toastTimer = [];
export function toast(msg, type = '') {
  const root = $('#toastRoot');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  root.appendChild(el);
  const t = setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; setTimeout(() => el.remove(), 260); }, 2600);
  toastTimer.push(t);
  if (toastTimer.length > 12) clearTimeout(toastTimer.shift());
}
export const busy = (on) => $('#busy')?.classList.toggle('hidden', !on);

/* ---------- bottom sheet ---------- */
let sheetClose = null;
export function closeSheet() {
  const root = $('#sheetRoot');
  root.innerHTML = '';
  document.body.style.overflow = '';
  if (sheetClose) { const f = sheetClose; sheetClose = null; f(); }
}
export function openSheet({ title = '', body = '', actions = '', onMount, onClose, dismissible = true }) {
  const root = $('#sheetRoot');
  root.innerHTML = `
    <div class="backdrop" data-act="backdrop"></div>
    <section class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <div class="sheet-title">${esc(title)}</div>
        <button class="icon-btn" data-act="close" aria-label="关闭">${ico('close', 16)}</button>
      </div>
      <div class="sheet-body" id="sheetBody">${body}</div>
      ${actions ? `<div class="sheet-actions" id="sheetActions">${actions}</div>` : ''}
    </section>`;
  document.body.style.overflow = 'hidden';
  sheetClose = onClose || null;
  root.querySelector('[data-act="close"]').onclick = closeSheet;
  root.querySelector('[data-act="backdrop"]').onclick = () => { if (dismissible) closeSheet(); };
  if (onMount) onMount(root);
  return root;
}
export function confirmSheet(title, message, onYes, yesLabel = '确认删除') {
  openSheet({
    title,
    body: `<p style="font-size:14px;line-height:1.6;color:var(--text-2);margin:4px 2px 18px">${esc(message)}</p>`,
    actions: `<button class="btn" data-act="no">取消</button><button class="btn btn-danger" data-act="yes">${esc(yesLabel)}</button>`,
    onMount(root) {
      root.querySelector('[data-act="no"]').onclick = closeSheet;
      root.querySelector('[data-act="yes"]').onclick = () => { closeSheet(); onYes(); };
    }
  });
}
export function promptSheet({ title, label, value = '', placeholder = '', hint = '', multiline = false, confirmLabel = '保存', onConfirm }) {
  openSheet({
    title,
    body: `<div class="field"><label>${esc(label)}</label>${multiline
      ? `<textarea class="textarea" id="_promptInput" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
      : `<input class="input" id="_promptInput" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">`}
      ${hint ? `<div class="field-hint">${esc(hint)}</div>` : ''}</div>`,
    actions: `<button class="btn" data-act="no">取消</button><button class="btn btn-primary" data-act="yes">${esc(confirmLabel)}</button>`,
    onMount(root) {
      const input = root.querySelector('#_promptInput');
      setTimeout(() => input.focus(), 120);
      root.querySelector('[data-act="no"]').onclick = closeSheet;
      root.querySelector('[data-act="yes"]').onclick = () => { const v = input.value; closeSheet(); onConfirm(v); };
    }
  });
}

/* tiny event delegation helper */
export function delegate(root, selector, event, handler) {
  root.addEventListener(event, (e) => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) handler(e, t);
  });
}
export function debounce(fn, ms = 300) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
