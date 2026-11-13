/* Transfers — the task list, filters, bulk actions, detail & add sheets */
import { state, runtime, save, getServer } from '../store.js';
import { getClient, caps } from '../clients/index.js';
import { fileToBase64 } from '../transport.js';
import { App, bus } from '../core.js';
import {
  ico, esc, $, $$, fmtBytes, fmtSpeed, fmtDuration, fmtPct, fmtRatio, fmtDate,
  detectResolution, hostOf, toast, busy, openSheet, closeSheet, confirmSheet,
  promptSheet, debounce, uid
} from '../util.js';
import { STATUS, splitTags } from '../clients/common.js';
import { matchPosters, posterFor } from '../posters.js';

const QUICK = [
  { k: 'all', n: '全部' }, { k: 'active', n: '活动' }, { k: 'downloading', n: '下载中' },
  { k: 'seeding', n: '做种中' }, { k: 'paused', n: '已暂停' }, { k: 'error', n: '错误' }
];
const SORTS = [
  { k: 'dateAdded', n: '添加时间' }, { k: 'name', n: '名称' }, { k: 'dlSpeed', n: '下载速度' },
  { k: 'upSpeed', n: '上传速度' }, { k: 'size', n: '大小' }, { k: 'progress', n: '进度' }
];

function alias(host) {
  const a = state.settings.trackerAliases || {};
  return a[host] || a[host.toLowerCase()] || host;
}
function matchesStatus(t, f) {
  switch (f) {
    case 'active': return t.dlSpeed > 0 || t.upSpeed > 0;
    case 'downloading': return t.status === 'downloading';
    case 'seeding': return t.status === 'seeding';
    case 'paused': return t.status === 'paused' || t.status === 'queued';
    case 'error': return t.status === 'error';
    default: return true;
  }
}
export function visibleTasks() {
  const q = (runtime.search || '').trim().toLowerCase();
  let list = runtime.tasks.filter(t => {
    if (!matchesStatus(t, runtime.statusFilter)) return false;
    if (runtime.categoryFilter && String(t.category || '').toLowerCase() !== runtime.categoryFilter.toLowerCase()) return false;
    if (runtime.tagFilter && !(t.tags || []).includes(runtime.tagFilter)) return false;
    if (runtime.trackerFilter && alias(hostOf(t.tracker)) !== runtime.trackerFilter) return false;
    if (q) {
      const hay = [t.name, hostOf(t.tracker), alias(hostOf(t.tracker)), (t.tags || []).join(' ')].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const key = runtime.sortKey, dir = runtime.sortAsc ? 1 : -1;
  list.sort((a, b) => {
    let r = 0;
    if (key === 'name') r = String(a.name).localeCompare(String(b.name), 'zh-CN');
    else {
      const map = { dateAdded: 'addedOn', dlSpeed: 'dlSpeed', upSpeed: 'upSpeed', size: 'size', progress: 'progress' };
      const f = map[key] || 'addedOn';
      r = (Number(a[f]) || 0) - (Number(b[f]) || 0);
    }
    return r === 0 ? String(a.id).localeCompare(String(b.id)) : r * dir;
  });
  return list;
}
function filterOptions(kind) {
  const set = new Set();
  runtime.tasks.forEach(t => {
    if (kind === 'category' && t.category) set.add(t.category);
    if (kind === 'tag') (t.tags || []).forEach(x => set.add(x));
    if (kind === 'tracker' && t.tracker) set.add(alias(hostOf(t.tracker)));
  });
  return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
function hue(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }

export function posterHTML(t, small = false) {
  const url = posterFor(t), res = detectResolution(t.name);
  const h = hue(t.name || 'x');
  const initials = String(t.name || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2) || 'QT';
  return `<div class="poster" style="background:linear-gradient(140deg,hsl(${h},58%,84%),hsl(${(h + 55) % 360},58%,74%))${small ? ';width:26px;height:38px;border-radius:5px;flex:none' : ''}">
    ${url ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.style.display='none'">` : `<span class="ph" ${small ? 'style="font-size:10px"' : ''}>${esc(initials)}</span>`}
    ${res && !small ? `<span class="res-badge">${res}</span>` : ''}
  </div>`;
}

function taskCard(t) {
  const st = STATUS[t.status] || STATUS.paused;
  const checked = runtime.selected.has(t.id);
  const tags = (t.tags || []).slice(0, 3).map((x, i) => `<span class="tag ${['blue', 'mint', 'purple'][i % 3]}">${esc(x)}</span>`).join('');
  const cat = t.category ? `<span class="tag orange">${esc(t.category)}</span>` : '';
  const more = (t.tags || []).length > 3 ? `<span class="tag">+${t.tags.length - 3}</span>` : '';
  const tr = hostOf(t.tracker) ? `<span class="tag">${esc(alias(hostOf(t.tracker)))}</span>` : '';
  const badge = `<span class="srv-badge ${t.serverType === 'tr' ? 'tr' : 'qb'}" title="${esc(t.serverName)}">${t.serverType === 'tr' ? 'tr' : 'qb'}</span>`;
  const dur = t.status === 'downloading' ? fmtDuration(t.eta) : fmtDuration(t.seedingTime);
  return `<article class="task-card ${checked ? 'selected' : ''}" data-st="${t.status}" data-act="task" data-id="${esc(t.id)}">
    ${posterHTML(t)}
    <div class="task-body">
      <div class="task-head">
        <div class="task-title">${esc(t.name)}</div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;margin:3px 0 4px">
        <div class="task-state ${t.status}"><i></i>${st.label} ${fmtPct(t.progress)}</div>${badge}
      </div>
      ${(tags || cat || tr) ? `<div class="tag-row">${cat}${tags}${more}${tr}</div>` : ''}
      <div class="progress"><i style="width:${Math.min(100, (Number(t.progress) || 0) * 100)}%"></i></div>
      <div class="task-meta">
        <div class="m">${ico('arrowDown', 11)}<span>${fmtSpeed(t.dlSpeed)}</span></div>
        <div class="m">${ico('arrowUp', 11)}<span>${fmtSpeed(t.upSpeed)}</span></div>
        <div class="m">${ico('file', 11)}<span>${fmtBytes(t.size)}</span></div>
        <div class="m">${ico('clock', 11)}<span>${dur}</span></div>
        <div class="m">${ico('layers', 11)}<span>${t.numPeers}/${t.totalPeers} · ${t.numSeeds}/${t.totalSeeds}</span></div>
        <div class="m">${ico('ratio', 11)}<span>${fmtRatio(t.ratio)}</span></div>
        <div class="m" style="grid-column:1/-1">${ico('folder', 11)}<span>${esc(t.savePath || '—')}</span></div>
      </div>
    </div>
    ${runtime.selectionMode ? `<div class="checkbox ${checked ? 'on' : ''}" style="position:absolute;top:10px;left:10px;background:var(--card)">${checked ? ico('check', 13) : ''}</div>` : ''}
  </article>`;
}

export function summaryHTML() {
  const list = visibleTasks();
  const dl = list.reduce((a, t) => a + (t.dlSpeed || 0), 0);
  const ul = list.reduce((a, t) => a + (t.upSpeed || 0), 0);
  const size = list.reduce((a, t) => a + (t.size || 0), 0);
  return `<div class="summary-row">
    <span>${ico('leaf', 14)} <span class="num">${list.length}</span></span>
    <span>${ico('archive', 14)} <b>${fmtBytes(size)}</b></span>
    <span class="spacer"></span>
    <span class="speed">↓ ${fmtSpeed(dl)}</span><span class="speed">↑ ${fmtSpeed(ul)}</span>
  </div>`;
}
export function listHTML() {
  const list = visibleTasks();
  if (!list.length) {
    const noServer = !state.servers.length;
    return `<div class="empty">
      <div class="ico">${ico(noServer ? 'server' : 'list', 30)}</div>
      <h3>${noServer ? '还没有添加服务器' : '没有符合条件的任务'}</h3>
      <p>${noServer ? '在「设置 → 服务器设置」中添加 qBittorrent 或 Transmission，即可开始管理下载任务。' : '试试调整搜索关键词或筛选条件。'}</p>
      <button class="btn btn-primary" data-act="${noServer ? 'add-server' : 'clear-filters'}">${noServer ? '添加服务器' : '清除筛选'}</button>
    </div>`;
  }
  return `<div class="task-list">${list.map(taskCard).join('')}</div>`;
}

export function topbar() {
  const s = state.activeServerId === 'all' ? null : getServer(state.activeServerId);
  return `<button class="icon-btn" data-act="server-picker" title="切换服务器">${ico('grid', 17)}</button>
    <div class="topbar-title">${esc(s ? s.name : (state.settings.aggregate ? '传输任务' : '传输任务'))}</div>
    <div class="topbar-actions">
      <button class="icon-btn" data-act="sort" title="排序">${ico('sort', 17)}</button>
      <button class="icon-btn" data-act="select-toggle" title="多选">${ico(runtime.selectionMode ? 'checkCircle' : 'checkCircle', 17)}</button>
    </div>`;
}

export function html() {
  const filters = [
    { k: 'status', n: runtime.statusFilter === 'all' ? '状态' : (QUICK.find(q => q.k === runtime.statusFilter)?.n || '状态') },
    { k: 'category', n: runtime.categoryFilter || '分类' },
    { k: 'tag', n: runtime.tagFilter || '标签' },
    { k: 'tracker', n: runtime.trackerFilter || 'Tracker' }
  ];
  return `
  <div class="search-bar">${ico('search', 17)}<input id="searchInput" data-input="search" type="search" placeholder="搜索任务..." value="${esc(runtime.search)}" autocomplete="off"></div>
  <div id="summaryRow">${summaryHTML()}</div>
  <div class="filter-bar">${filters.map(f => `<button class="filter-chip ${((f.k === 'status' && runtime.statusFilter !== 'all') || (f.k !== 'status' && f.n !== ({ status: '状态', category: '分类', tag: '标签', tracker: 'Tracker' })[f.k])) ? 'active' : ''}" data-act="filter" data-kind="${f.k}">${esc(f.n)} ${ico('down', 12)}</button>`).join('')}</div>
  <div class="quick-row">${QUICK.map(q => `<button class="quick-pill ${runtime.statusFilter === q.k ? 'active' : ''}" data-act="quick" data-k="${q.k}">${q.n}</button>`).join('')}</div>
  <div id="taskList">${listHTML()}</div>
  <div class="refresh-note">${runtime.lastRefresh ? '更新于 ' + new Date(runtime.lastRefresh).toLocaleTimeString('zh-CN', { hour12: false }) : '等待首次刷新'}</div>
  ${runtime.selectionMode ? bulkBar() : `<button class="fab" data-act="add-torrent" aria-label="添加任务">${ico('plus', 24)}</button>`}
  `;
}

function bulkBar() {
  return `<div class="bulkbar">
    <span class="sel-count">已选 ${runtime.selected.size}</span>
    <button data-act="bulk" data-op="resume">${ico('play', 19)}恢复</button>
    <button data-act="bulk" data-op="pause">${ico('pause', 19)}暂停</button>
    <button data-act="bulk" data-op="force">${ico('bolt', 19)}强制</button>
    <button data-act="bulk" data-op="recheck">${ico('refresh', 19)}校验</button>
    <button data-act="bulk" data-op="delete">${ico('trash', 19)}删除</button>
    <button data-act="select-exit">${ico('close', 19)}取消</button>
  </div>`;
}

/* ---------------- interaction ---------------- */
const updateList = () => {
  const l = $('#taskList'), s = $('#summaryRow');
  if (l) l.innerHTML = listHTML();
  if (s) s.innerHTML = summaryHTML();
};
const debouncedList = debounce(updateList, 260);

export function onInput(key, value) {
  if (key === 'search') { runtime.search = value; debouncedList(); }
}
export function onShow() {
  if ((state.settings.tmdbKey || '').trim() && runtime.tasks.length) {
    matchPosters(runtime.tasks.slice(0, 20), 4).then(n => { if (n) App.renderPage(); });
  }
}

export async function onAction(act, el, e) {
  switch (act) {
    case 'quick': runtime.statusFilter = el.dataset.k; App.renderPage(); return;
    case 'clear-filters':
      runtime.search = ''; runtime.statusFilter = 'all'; runtime.categoryFilter = '';
      runtime.tagFilter = ''; runtime.trackerFilter = ''; App.renderPage(); return;
    case 'filter': openFilterSheet(el.dataset.kind); return;
    case 'sort': openSortSheet(); return;
    case 'server-picker': openServerPicker(); return;
    case 'select-toggle': runtime.selectionMode = !runtime.selectionMode; runtime.selected.clear(); App.renderPage(); return;
    case 'select-exit': runtime.selectionMode = false; runtime.selected.clear(); App.renderPage(); return;
    case 'task': {
      const t = runtime.tasks.find(x => x.id === el.dataset.id);
      if (!t) return;
      if (runtime.selectionMode) {
        runtime.selected.has(t.id) ? runtime.selected.delete(t.id) : runtime.selected.add(t.id);
        updateList();
      } else openTaskDetail(t);
      return;
    }
    case 'bulk': return runBulk(el.dataset.op);
    case 'add-torrent': return openAddTorrent();
  }
}

/* ---------------- sheets ---------------- */
function sheetOption(label, value, current, extra = '') {
  return `<button class="row" data-sheet-act="pick" data-value="${esc(value)}" style="width:100%;text-align:left;background:transparent;color:var(--text)">
    <span class="row-txt"><span class="row-title">${esc(label)}</span></span>
    ${String(current) === String(value) ? `<span style="color:var(--blue)">${ico('check', 17)}</span>` : ''}${extra}
  </button>`;
}
function openFilterSheet(kind) {
  const current = { status: runtime.statusFilter, category: runtime.categoryFilter, tag: runtime.tagFilter, tracker: runtime.trackerFilter }[kind];
  const opts = kind === 'status'
    ? QUICK.map(q => ({ k: q.k, n: q.n }))
    : [{ k: '', n: '全部' }, ...filterOptions(kind).map(x => ({ k: x, n: x }))];
  const title = { status: '按状态筛选', category: '按分类筛选', tag: '按标签筛选', tracker: '按 Tracker 筛选' }[kind];
  openSheet({
    title,
    body: `<div class="list-group">${opts.map(o => sheetOption(o.n, o.k, current)).join('')}</div>
      ${kind === 'category' && state.activeServerId !== 'all' && getServer(state.activeServerId)?.type === 'tr' ? '<div class="banner">Transmission 不支持分类。</div>' : ''}`,
    onMount(root) {
      $$('[data-sheet-act="pick"]', root).forEach(b => b.onclick = () => {
        const v = b.dataset.value;
        if (kind === 'status') runtime.statusFilter = v;
        if (kind === 'category') runtime.categoryFilter = v;
        if (kind === 'tag') runtime.tagFilter = v;
        if (kind === 'tracker') runtime.trackerFilter = v;
        closeSheet(); App.renderPage();
      });
    }
  });
}
function openSortSheet() {
  openSheet({
    title: '排序方式',
    body: `<div class="list-group">${SORTS.map(s => sheetOption(s.n, s.k, runtime.sortKey)).join('')}</div>
      <div class="section-title">顺序</div>
      <div class="segmented" style="margin-bottom:8px">
        <button data-sheet-act="asc" class="${!runtime.sortAsc ? 'on' : ''}">降序</button>
        <button data-sheet-act="desc" class="${runtime.sortAsc ? 'on' : ''}">升序</button>
      </div>`,
    onMount(root) {
      $$('[data-sheet-act="pick"]', root).forEach(b => b.onclick = () => { runtime.sortKey = b.dataset.value; closeSheet(); App.renderPage(); });
      root.querySelector('[data-sheet-act="asc"]').onclick = () => { runtime.sortAsc = false; closeSheet(); App.renderPage(); };
      root.querySelector('[data-sheet-act="desc"]').onclick = () => { runtime.sortAsc = true; closeSheet(); App.renderPage(); };
    }
  });
}
function openServerPicker() {
  const rows = [sheetOption('全部服务器（聚合）', 'all', state.activeServerId),
    ...state.servers.map(s => sheetOption(s.name, s.id, state.activeServerId))];
  openSheet({
    title: '选择服务器',
    body: `<div class="list-group">${rows.join('')}</div>
      <button class="btn btn-block" data-sheet-act="manage" style="margin-top:12px">${ico('gear', 16)} 管理服务器</button>`,
    onMount(root) {
      $$('[data-sheet-act="pick"]', root).forEach(b => b.onclick = () => {
        state.activeServerId = b.dataset.value; save(); closeSheet(); App.refresh();
      });
      root.querySelector('[data-sheet-act="manage"]').onclick = () => { closeSheet(); App.go('settings'); };
    }
  });
}

/* ---------------- add torrent ---------------- */
export function openAddTorrent() {
  const target = state.activeServerId === 'all' ? (state.servers[0]?.id || '') : state.activeServerId;
  if (!state.servers.length) { toast('请先添加服务器', 'err'); return; }
  const paths = state.settings.presetPaths || [];
  openSheet({
    title: '添加下载任务',
    body: `
      <div class="field"><label>目标服务器</label>
        <select class="select" id="addServer">${state.servers.map(s => `<option value="${esc(s.id)}" ${s.id === target ? 'selected' : ''}>${esc(s.name)} · ${s.type === 'tr' ? 'Transmission' : 'qBittorrent'}</option>`).join('')}</select>
      </div>
      <div class="field"><label>磁力链接 / HTTP 链接（每行一个）</label>
        <textarea class="textarea" id="addUrls" placeholder="magnet:?xt=urn:btih:...&#10;https://example.com/file.torrent"></textarea></div>
      <div class="field"><label>种子文件 (.torrent)</label>
        <input class="input" type="file" id="addFiles" accept=".torrent,application/x-bittorrent" multiple>
        <div class="field-hint" id="fileHint">可同时选择多个文件</div></div>
      <div class="field"><label>保存路径（可选）</label>
        <input class="input" id="addPath" list="presetPaths" placeholder="留空使用服务器默认路径">
        <datalist id="presetPaths">${paths.map(p => `<option value="${esc(p)}">`).join('')}</datalist></div>
      <div class="field"><label>分类（qBittorrent）</label><input class="input" id="addCategory" placeholder="可选"></div>
      <div class="field"><label>标签（逗号分隔）</label><input class="input" id="addTags" placeholder="可选"></div>
      <div class="section-title" style="font-size:15px;margin:8px 2px 10px">高级选项</div>
      <div class="list-group" style="margin-bottom:14px">
        ${toggleRow('optPaused', '添加后暂停', false)}
        ${toggleRow('optSkip', '跳过哈希校验', false)}
        ${toggleRow('optSeq', '顺序下载', false)}
        ${toggleRow('optFL', '首尾分片优先', false)}
      </div>`,
    actions: `<button class="btn" data-sheet-act="cancel">取消</button><button class="btn btn-primary" data-sheet-act="submit">添加任务</button>`,
    onMount(root) {
      const fileInput = root.querySelector('#addFiles');
      fileInput.onchange = () => { root.querySelector('#fileHint').textContent = fileInput.files.length ? `已选择 ${fileInput.files.length} 个文件` : '可同时选择多个文件'; };
      $$('[data-sheet-act="tg"]', root).forEach(b => b.onclick = () => {
        b.classList.toggle('on');
        b.dataset.on = b.classList.contains('on') ? '1' : '0';
      });
      root.querySelector('[data-sheet-act="cancel"]').onclick = closeSheet;
      root.querySelector('[data-sheet-act="submit"]').onclick = async () => {
        const sid = root.querySelector('#addServer').value;
        const s = getServer(sid);
        const urls = root.querySelector('#addUrls').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
        const files = [];
        for (const f of fileInput.files) files.push({ name: f.name, base64: await fileToBase64(f) });
        if (!urls.length && !files.length) { toast('请填写链接或选择种子文件', 'err'); return; }
        const opts = {
          savePath: root.querySelector('#addPath').value.trim(),
          category: root.querySelector('#addCategory').value.trim(),
          tags: splitTags(root.querySelector('#addTags').value),
          isPaused: tg(root, 'optPaused'), skipHashCheck: tg(root, 'optSkip'),
          isSequential: tg(root, 'optSeq'), isFirstLastPiecePriority: tg(root, 'optFL')
        };
        closeSheet(); busy(true);
        try {
          await getClient(s).addTorrent({ urls, files, options: opts });
          toast(`已提交 ${urls.length + files.length} 个任务`, 'ok');
          await App.refresh(true);
        } catch (err) { toast(err.message || '添加失败', 'err'); }
        finally { busy(false); }
      };
    }
  });
}
function toggleRow(id, label, on) {
  return `<div class="row"><span class="row-txt"><span class="row-title">${label}</span></span>
    <button class="switch ${on ? 'on' : ''}" data-sheet-act="tg" data-tg="${id}" data-on="${on ? 1 : 0}" type="button"></button></div>`;
}
function tg(root, id) { return root.querySelector(`[data-tg="${id}"]`)?.dataset.on === '1'; }

/* ---------------- task detail ---------------- */
export function openTaskDetail(t) {
  const s = getServer(t.serverId);
  const c = s ? getClient(s) : null;
  const cp = s ? caps(s) : {};
  const st = STATUS[t.status] || STATUS.paused;
  const info = [
    ['状态', `${st.label} · ${fmtPct(t.progress)}`], ['大小', fmtBytes(t.size)],
    ['已下载', fmtBytes(t.downloaded)], ['已上传', fmtBytes(t.uploaded)],
    ['分享率', fmtRatio(t.ratio)], ['剩余时间', fmtDuration(t.eta)],
    ['做种时长', fmtDuration(t.seedingTime)], ['连接数', `${t.numPeers}/${t.totalPeers}`],
    ['种子数', `${t.numSeeds}/${t.totalSeeds}`], ['保存路径', t.savePath || '—'],
    ['分类', t.category || '—'], ['标签', (t.tags || []).join(', ') || '—'],
    ['Tracker', alias(hostOf(t.tracker)) || '—'], ['添加时间', fmtDate(t.addedOn)],
    ['完成时间', fmtDate(t.completedOn)], ['服务器', t.serverName || '—'],
    ['Hash', t.hash]
  ];
  const btn = (a, icon, label, cls = '') => `<button class="btn btn-sm ${cls}" data-sheet-act="${a}">${ico(icon, 15)}${label}</button>`;
  openSheet({
    title: '任务详情',
    body: `
      <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:14px">
        ${posterHTML(t)}
        <div style="flex:1;min-width:0">
          <div style="font-size:15px;font-weight:650;line-height:1.35;word-break:break-word">${esc(t.name)}</div>
          <div style="margin-top:6px"><span class="task-state ${t.status}" style="font-size:12px"><i></i>${st.label} ${fmtPct(t.progress)}</span></div>
          <div class="progress" style="margin-top:8px"><i style="width:${Math.min(100, t.progress * 100)}%"></i></div>
        </div>
      </div>
      <div class="banner ${t.error ? '' : 'info'}" style="${t.error ? '' : 'display:none'}">${esc(t.error || '')}</div>
      <div class="hstack" style="flex-wrap:wrap;gap:7px;margin-bottom:14px">
        ${btn('pause', 'pause', '暂停')}${btn('resume', 'play', '恢复')}${btn('force', 'bolt', '强制开始')}
        ${btn('recheck', 'refresh', '校验')}${btn('reannounce', 'globe', '重新宣告')}
        ${btn('rename', 'edit', '重命名')}${btn('location', 'folder', '改路径')}
        ${btn('limit', 'gauge', '限速')}${btn('tag', 'tag', '标签/分类')}
        ${cp.sequential ? btn('seq', 'list', '顺序下载') : ''}
        ${btn('files', 'file', '文件列表')}${btn('trackers', 'link', 'Tracker')}
        ${btn('delete', 'trash', '删除', 'btn-danger')}
      </div>
      <div class="section-title" style="font-size:16px">基本信息</div>
      <div class="list-group" style="padding:6px 12px">${info.map(([k, v]) => `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('')}</div>
      <div id="detailExtra"></div>`,
    onMount(root) {
      const run = async (fn, okMsg) => {
        busy(true);
        try { await fn(c); toast(okMsg || '操作成功', 'ok'); closeSheet(); await App.refresh(true); }
        catch (err) { toast(err.message || '操作失败', 'err'); }
        finally { busy(false); }
      };
      const h = t.hash;
      const map = {
        pause: () => run(cl => cl.pause([h]), '已暂停'),
        resume: () => run(cl => cl.resume([h]), '已恢复'),
        force: () => run(cl => cl.forceStart([h]), '已强制开始'),
        recheck: () => run(cl => cl.recheck([h]), '已开始校验'),
        reannounce: () => run(cl => cl.reannounce([h]), '已重新宣告'),
        seq: () => run(cl => cl.sequential([h]), '已切换顺序下载'),
        delete: () => { closeSheet(); confirmSheet('删除任务', `确定删除「${t.name}」吗？可选择同时删除本地文件。此操作不可撤销。`, async () => {
          const withFiles = await askDeleteFiles();
          run(cl => cl.remove([h], withFiles), '已删除');
        }, '删除'); },
        rename: () => { closeSheet(); promptSheet({ title: '重命名任务', label: '新名称', value: t.name, confirmLabel: '保存', onConfirm: v => v.trim() && run(cl => cl.rename(h, v.trim()), '已重命名') }); },
        location: () => { closeSheet(); promptSheet({ title: '修改保存路径', label: '绝对路径', value: t.savePath, hint: '任务文件将被移动到该目录', onConfirm: v => v.trim() && run(cl => cl.setLocation([h], v.trim()), '已修改路径') }); },
        limit: () => { closeSheet(); openLimitSheet(t, c, s); },
        tag: () => { closeSheet(); openTagSheet(t, c, s); },
        files: () => loadDetailExtra('files', t, c, root),
        trackers: () => loadDetailExtra('trackers', t, c, root)
      };
      $$('[data-sheet-act]', root).forEach(b => { const a = b.dataset.sheetAct; if (map[a]) b.onclick = map[a]; });
    }
  });
}

async function askDeleteFiles() {
  return new Promise(resolve => {
    openSheet({
      title: '删除选项', body: '<p style="font-size:14px;color:var(--secondary);padding:4px 2px 8px">是否同时删除服务器上的本地文件？</p>',
      actions: '<button class="btn" data-sheet-act="keep">保留文件</button><button class="btn btn-danger" data-sheet-act="both">删除任务与文件</button>',
      onMount(root) {
        root.querySelector('[data-sheet-act="keep"]').onclick = () => { resolve(false); closeSheet(); };
        root.querySelector('[data-sheet-act="both"]').onclick = () => { resolve(true); closeSheet(); };
      },
      onClose: () => resolve(false)
    });
  });
}

async function loadDetailExtra(kind, t, c, root) {
  const box = root.querySelector('#detailExtra');
  if (!box) return;
  box.innerHTML = `<div class="refresh-note">加载中…</div>`;
  try {
    if (kind === 'files') {
      const files = await c.getFiles(t.hash);
      box.innerHTML = `<div class="section-title" style="font-size:16px">文件列表 (${files.length})</div>
        <div class="list-group" style="padding:4px 12px">${files.map(f => `<div class="file-row">
          <span class="fn" title="${esc(f.name)}">${esc(f.name)}</span>
          <span class="fp"><i style="width:${Math.round(f.progress * 100)}%"></i></span>
          <span class="tiny muted" style="width:64px;text-align:right">${fmtBytes(f.size)}</span>
        </div>`).join('') || '<div class="empty"><p>没有文件</p></div>'}</div>`;
    } else {
      const list = await c.getTrackers(t.hash);
      box.innerHTML = `<div class="section-title" style="font-size:16px">Tracker (${list.length})</div>
        <div class="list-group">${list.map(x => `<div class="row"><span class="row-txt">
          <span class="row-title">${esc(x.url)}</span>
          <span class="row-sub">${esc(x.msg || '')} · 种子 ${x.numSeeds} · 用户 ${x.numPeers}</span></span>
          <span class="status-dot ${x.status === 2 ? '' : 'pending'}"></span></div>`).join('') || '<div class="empty"><p>没有 Tracker</p></div>'}</div>`;
    }
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) { box.innerHTML = `<div class="banner">${esc(e.message)}</div>`; }
}

function openLimitSheet(t, c, s) {
  const unit = s.type === 'tr' ? 'KB/s' : 'KB/s';
  openSheet({
    title: '速度限制',
    body: `<div class="banner info">单位 ${unit}，填 0 表示不限制。Transmission 的单任务限速以 KB/s 计。</div>
      <div class="field"><label>下载限速 (KB/s)</label><input class="input" id="limDl" type="number" min="0" value="0"></div>
      <div class="field"><label>上传限速 (KB/s)</label><input class="input" id="limUl" type="number" min="0" value="0"></div>
      <div class="field"><label>分享率限制（0 = 不限）</label><input class="input" id="limRatio" type="number" step="0.1" min="0" value="0"></div>`,
    actions: '<button class="btn" data-sheet-act="cancel">取消</button><button class="btn btn-primary" data-sheet-act="ok">保存</button>',
    onMount(root) {
      c.getProperties(t.hash).then(p => {
        root.querySelector('#limDl').value = Math.round((p.dlLimit || 0) / 1024);
        root.querySelector('#limUl').value = Math.round((p.upLimit || 0) / 1024);
      }).catch(() => {});
      root.querySelector('[data-sheet-act="cancel"]').onclick = closeSheet;
      root.querySelector('[data-sheet-act="ok"]').onclick = async () => {
        const dl = Number(root.querySelector('#limDl').value) || 0;
        const ul = Number(root.querySelector('#limUl').value) || 0;
        const ratio = Number(root.querySelector('#limRatio').value) || 0;
        const bytes = (v) => s.type === 'tr' ? v : v * 1024;
        closeSheet(); busy(true);
        try {
          await Promise.all([
            c.setDownloadLimit([t.hash], bytes(dl)),
            c.setUploadLimit([t.hash], bytes(ul)),
            ratio > 0 ? c.setShareLimits([t.hash], ratio, 0) : Promise.resolve()
          ]);
          toast('限速已保存', 'ok'); await App.refresh(true);
        } catch (e) { toast(e.message, 'err'); } finally { busy(false); }
      };
    }
  });
}
function openTagSheet(t, c, s) {
  openSheet({
    title: '标签与分类',
    body: `<div class="field"><label>标签（逗号分隔，保存后覆盖）</label><input class="input" id="tgAll" value="${esc((t.tags || []).join(', '))}"></div>
      ${caps(s).categories ? `<div class="field"><label>分类</label><input class="input" id="tgCat" value="${esc(t.category || '')}"></div>` : '<div class="banner">Transmission 使用标签（labels），不支持分类。</div>'}`,
    actions: '<button class="btn" data-sheet-act="cancel">取消</button><button class="btn btn-primary" data-sheet-act="ok">保存</button>',
    onMount(root) {
      root.querySelector('[data-sheet-act="cancel"]').onclick = closeSheet;
      root.querySelector('[data-sheet-act="ok"]').onclick = async () => {
        const tags = splitTags(root.querySelector('#tgAll').value);
        const cat = root.querySelector('#tgCat')?.value.trim();
        closeSheet(); busy(true);
        try {
          if (caps(s).categories && cat !== undefined && cat !== t.category) await c.setCategory([t.hash], cat);
          await c.addTags([t.hash], tags);
          toast('已保存', 'ok'); await App.refresh(true);
        } catch (e) { toast(e.message, 'err'); } finally { busy(false); }
      };
    }
  });
}

/* ---------------- bulk ---------------- */
async function runBulk(op) {
  if (!runtime.selected.size) { toast('请先选择任务', 'err'); return; }
  const groups = new Map();
  runtime.tasks.filter(t => runtime.selected.has(t.id)).forEach(t => {
    if (!groups.has(t.serverId)) groups.set(t.serverId, []);
    groups.get(t.serverId).push(t.hash);
  });
  const doIt = async (c, hashes) => {
    switch (op) {
      case 'resume': return c.resume(hashes);
      case 'pause': return c.pause(hashes);
      case 'force': return c.forceStart(hashes);
      case 'recheck': return c.recheck(hashes);
      case 'delete': return c.remove(hashes, false);
    }
  };
  const label = { resume: '恢复', pause: '暂停', force: '强制开始', recheck: '校验', delete: '删除' }[op];
  const exec = async () => {
    busy(true);
    try {
      const results = await Promise.allSettled([...groups.entries()].map(([sid, hashes]) => doIt(getClient(getServer(sid)), hashes)));
      const bad = results.filter(r => r.status === 'rejected');
      toast(bad.length ? `${label}完成，${bad.length} 台服务器失败` : `已${label} ${runtime.selected.size} 个任务`, bad.length ? 'err' : 'ok');
      runtime.selectionMode = false; runtime.selected.clear();
      await App.refresh(true);
    } finally { busy(false); }
  };
  if (op === 'delete') {
    confirmSheet('批量删除', `确定删除选中的 ${runtime.selected.size} 个任务吗？服务器上的文件会保留。`, exec, '删除');
  } else await exec();
}
