/* Boot, router, refresh scheduler, global event delegation */
import { state, runtime, load, save, activeServers, getServer } from './store.js';
import { getClient, invalidateClients } from './clients/index.js';
import { currentMode } from './transport.js';
import { App, bus } from './core.js';
import { $, esc, ico, toast, busy, closeSheet } from './util.js';

import * as dashboard from './views/dashboard.js';
import * as transfers from './views/transfers.js';
import * as automation from './views/automation.js';
import * as moviepilot from './views/moviepilot.js';
import * as settings from './views/settings.js';

const VIEWS = { dashboard, transfers, automation, moviepilot, settings };
const TABS = [
  { id: 'dashboard', label: '仪表盘', icon: 'chart' },
  { id: 'transfers', label: '任务', icon: 'list' },
  { id: 'automation', label: '自动化', icon: 'rss' },
  { id: 'moviepilot', label: 'MoviePilot', icon: 'film' },
  { id: 'settings', label: '设置', icon: 'gear' }
];

let timer = null;
let failCount = {};

function applyTheme() {
  const t = state.settings.theme || 'auto';
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#metaTheme')?.setAttribute('content', dark ? '#000000' : '#f2f2f7');
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((state.settings.theme || 'auto') === 'auto') applyTheme();
});

function renderTabbar() {
  $('#tabbar').innerHTML = TABS.map(t => `
    <button class="tab ${runtime.page === t.id ? 'on' : ''}" data-act="tab" data-id="${t.id}">
      ${ico(t.icon, 21)}<span>${t.label}</span>
    </button>`).join('');
}

function renderPage() {
  const v = VIEWS[runtime.page] || VIEWS.dashboard;
  const y = window.scrollY;
  const active = document.activeElement;
  const activeId = active && active.id && active.closest('#page') ? active.id : null;
  const ss = activeId && active.setSelectionRange ? active.selectionStart : null;
  $('#topbar').innerHTML = typeof v.topbar === 'function' ? v.topbar() : '';
  $('#page').innerHTML = typeof v.html === 'function' ? v.html() : '';
  renderTabbar();
  window.scrollTo(0, y);
  if (activeId) {
    const n = document.getElementById(activeId);
    if (n) { n.focus(); try { if (ss !== null) n.setSelectionRange(ss, ss); } catch {} }
  }
}

function go(page) {
  if (!VIEWS[page]) return;
  if (runtime.page !== page) { runtime.page = page; runtime.selectionMode = false; runtime.selected.clear(); }
  VIEWS[runtime.page]?.onHide?.();
  closeSheet();
  renderPage();
  window.scrollTo(0, 0);
  VIEWS[page]?.onShow?.();
}

function mergeTasks() {
  const ids = state.activeServerId === 'all' ? state.servers.map(s => s.id) : [state.activeServerId];
  const all = [];
  ids.forEach(id => {
    const entry = runtime.tasksByServer[id];
    if (entry && Array.isArray(entry.tasks)) all.push(...entry.tasks);
  });
  runtime.tasks = all;
}

async function refresh(silent = false) {
  if (runtime.refreshing) return;
  const servers = state.servers.slice();
  if (!servers.length) {
    runtime.tasks = []; runtime.tasksByServer = {}; runtime.stats = {};
    renderPage(); return;
  }
  runtime.refreshing = true;
  if (!silent) bus.emit('refreshing', true);
  const now = Date.now();
  await Promise.all(servers.map(async s => {
    const c = getClient(s);
    try {
      const tasks = await c.fetchTorrents();
      runtime.tasksByServer[s.id] = { tasks, error: '', updatedAt: Date.now() };
      runtime.connection[s.id] = 'online';
      failCount[s.id] = 0;
      // Global stats are relatively heavy; cache for 30s like the original app.
      const cached = runtime.stats[s.id];
      if (!cached || now - (cached._at || 0) > 30000) {
        try {
          const st = await c.stats(tasks);
          st._at = Date.now();
          runtime.stats[s.id] = st;
          // Baseline for "recent transfer" module.
          if (!runtime.baseline[s.id]) {
            runtime.baseline[s.id] = { dl: st.alltimeDL || 0, ul: st.alltimeUL || 0, at: Math.floor(Date.now() / 1000) };
            import('./store.js').then(m => m.saveBaseline());
          }
        } catch { /* stats are optional */ }
      }
    } catch (e) {
      failCount[s.id] = (failCount[s.id] || 0) + 1;
      if (failCount[s.id] >= 2) runtime.connection[s.id] = 'offline';
      const prev = runtime.tasksByServer[s.id];
      runtime.tasksByServer[s.id] = { tasks: prev?.tasks || [], error: e.message || '连接失败', updatedAt: prev?.updatedAt || 0 };
      if (!silent) toast(`${s.name}: ${e.message || '连接失败'}`, 'err');
    }
  }));
  runtime.lastRefresh = Date.now();
  runtime.refreshing = false;
  mergeTasks();
  bus.emit('refreshing', false);
  bus.emit('data');
  renderPage();
}

function restartTimer() {
  if (timer) clearInterval(timer);
  const sec = Math.max(2, Number(state.settings.refreshInterval) || 5);
  timer = setInterval(() => {
    if (document.visibilityState === 'visible' && state.servers.length) refresh(true);
  }, sec * 1000);
}

/* ---------- global action / input delegation ---------- */
async function handleAction(act, el, e) {
  const v = VIEWS[runtime.page];
  switch (act) {
    case 'tab': go(el.dataset.id); return;
    case 'close-sheet': closeSheet(); return;
    case 'refresh': toast('正在刷新…'); await refresh(); return;
    case 'add-torrent': transfers.openAddTorrent(); return;
    case 'add-server': settings.openServerEditor(null); return;
  }
  if (typeof v?.onAction === 'function') {
    try { await v.onAction(act, el, e); } catch (err) { console.error(err); toast(err.message || '操作失败', 'err'); }
  }
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.closest('#sheetRoot')) return;
  e.preventDefault();
  handleAction(el.dataset.act, el, e);
});
document.addEventListener('input', (e) => {
  const key = e.target.dataset?.input;
  if (key) VIEWS[runtime.page]?.onInput?.(key, e.target.value, e.target);
});
document.addEventListener('change', (e) => {
  const key = e.target.dataset?.change;
  if (key) VIEWS[runtime.page]?.onChange?.(key, e.target.value, e.target);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
  if (e.key === 'Enter' && e.target.dataset?.input === 'search') e.target.blur();
});

/* ---------- boot ---------- */
Object.assign(App, {
  go, renderPage, renderTabbar, applyTheme, refresh,
  action: handleAction,
  restartTimer,
  save,
  getView: (id) => VIEWS[id],
  serverById: getServer,
  activeServers
});

load();
applyTheme();
invalidateClients();
// PWA shortcuts / deep links: /?tab=transfers
const initialTab = new URLSearchParams(location.search).get('tab');
go(VIEWS[initialTab] ? initialTab : 'dashboard');
renderTabbar();
restartTimer();
refresh();
bus.emit('ready');

// Register service worker only for real http(s) hosting (not inside Capacitor).
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.Capacitor) {
  navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).catch(() => {});
}

// Diagnostics exposed for troubleshooting in the browser console.
window.OiiQT = { state, runtime, App, refresh, currentMode };
