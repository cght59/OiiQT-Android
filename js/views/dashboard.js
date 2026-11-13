/* Dashboard — mirrors OiiQT's module cards and poster wall */
import { state, runtime, save } from '../store.js';
import { App } from '../core.js';
import {
  ico, esc, $, $$, fmtBytes, fmtSpeed, fmtStorage, fmtRatio, fmtRelative,
  fmtDate, toast, openSheet, closeSheet, circleIco
} from '../util.js';
import { posterHTML } from './transfers.js';
import { DEFAULT_MODULES } from '../store.js';

const MODULES = [
  { k: 'posterWall', n: '海报墙' }, { k: 'liveTraffic', n: '流量监控' },
  { k: 'todayTransfer', n: '近期传输' }, { k: 'globalAssets', n: '数据聚合' },
  { k: 'serverStatus', n: '服务器状态' }, { k: 'storageAudit', n: '存储审计' },
  { k: 'recentFinished', n: '近期完成' }
];
let heroTimer = null;

function agg() {
  const tasks = runtime.tasks;
  const st = Object.values(runtime.stats || {});
  const dl = tasks.reduce((a, t) => a + (t.dlSpeed || 0), 0);
  const ul = tasks.reduce((a, t) => a + (t.upSpeed || 0), 0);
  return {
    dlSpeed: dl || st.reduce((a, s) => a + (s.dlSpeed || 0), 0),
    upSpeed: ul || st.reduce((a, s) => a + (s.upSpeed || 0), 0),
    seeding: tasks.filter(t => t.status === 'seeding').length,
    downloading: tasks.filter(t => t.status === 'downloading').length,
    freeSpace: st.reduce((a, s) => a + (s.freeSpace || 0), 0),
    alltimeDL: st.reduce((a, s) => a + (s.alltimeDL || 0), 0),
    alltimeUL: st.reduce((a, s) => a + (s.alltimeUL || 0), 0)
  };
}
function heroTasks() {
  return runtime.tasks
    .filter(t => t.completedOn > 0 || t.progress >= 0.999 || t.status === 'seeding')
    .sort((a, b) => (b.completedOn || b.addedOn) - (a.completedOn || a.addedOn))
    .slice(0, 5);
}
function statCard(iconName, color, value, unit, label) {
  return `<div class="stat-card">${circleIco(iconName, color)}<div class="stat-value">${value}${unit ? `<span class="unit">${unit}</span>` : ''}</div><div class="stat-label">${label}</div></div>`;
}
function speedNum(v) {
  const s = fmtBytes(v);
  const i = s.lastIndexOf(' ');
  return { n: s.slice(0, i), u: s.slice(i + 1) };
}

function heroHTML() {
  const list = heroTasks();
  if (!list.length) {
    return `<div class="hero"><div class="hero-slide on" style="background:linear-gradient(135deg,#7db9e8,#c9a7e8 55%,#f5b6a5)"></div>
      <div class="hero-shade"></div><div class="hero-caption"><div class="t">OiiQT 🌊</div><div class="s">添加服务器后，最近完成的作品会显示在这里</div></div></div>`;
  }
  const cur = Math.min(runtime.heroIndex, list.length - 1);
  return `<div class="hero" id="hero">
    ${list.map((t, i) => {
      const url = (runtime.posters[t.name] || '');
      const h = (t.name || 'x').split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 360;
      return `<div class="hero-slide ${i === cur ? 'on' : ''}" style="${url ? `background-image:url('${esc(url)}')` : `background:linear-gradient(135deg,hsl(${h},55%,62%),hsl(${(h + 70) % 360},55%,48%))`}"></div>`;
    }).join('')}
    <div class="hero-shade"></div>
    <div class="hero-caption"><div class="t">${esc(list[cur].name)}</div><div class="s">${list[cur].completedOn ? '完成于 ' + fmtRelative(list[cur].completedOn) : esc(list[cur].serverName || '')}</div></div>
    <div class="hero-dots">${list.map((_, i) => `<i class="${i === cur ? 'on' : ''}"></i>`).join('')}</div>
  </div>`;
}

function liveTrafficHTML(a) {
  const d = speedNum(a.dlSpeed), u = speedNum(a.upSpeed);
  return `<div class="section-title">流量监控</div><div class="grid-2">
    ${statCard('arrowDown', '#0a84ff', d.n, d.u + '/s', '总下载速度')}
    ${statCard('arrowUp', '#34c759', u.n, u.u + '/s', '总上传速度')}
  </div>`;
}
function globalAssetsHTML(a) {
  const total = a.dlSpeed + a.upSpeed;
  const b = speedNum(total);
  const fs = fmtStorage(a.freeSpace).split(' ');
  return `<div class="section-title">数据聚合</div><div class="grid-2">
    ${statCard('leaf', '#34c759', a.seeding, '个', '做种总数')}
    ${statCard('arrowDown', '#0a84ff', a.downloading, '个', '正在下载')}
    ${statCard('swap', '#ff9f0a', b.n, b.u + '/s', '实时总带宽')}
    ${statCard('disk', '#00c7be', fs[0], fs[1] || '', '剩余空间')}
  </div>`;
}
function serverStatusHTML() {
  if (!state.servers.length) return '';
  return `<div class="section-title">服务器状态</div><div class="grid-2">${state.servers.map(s => {
    const st = runtime.stats[s.id] || {};
    const tasks = runtime.tasksByServer[s.id]?.tasks || [];
    const up = st.upSpeed || 0, down = st.dlSpeed || 0;
    const size = tasks.reduce((x, t) => x + (t.size || 0), 0);
    const ratio = tasks.length ? tasks.reduce((x, t) => x + (t.ratio || 0), 0) / tasks.length : 0;
    const conn = runtime.connection[s.id] || 'pending';
    return `<div class="server-card">
      <div class="server-head"><span class="server-logo ${s.type === 'tr' ? 'tr' : 'qb'}">${s.type === 'tr' ? 'tr' : 'qb'}</span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name)}</span>
        <span class="status-dot ${conn === 'online' ? '' : conn === 'offline' ? 'off' : 'pending'}"></span></div>
      <div class="server-metrics">
        <span style="color:var(--green)">↑ ${fmtSpeed(up)}</span>
        <span style="color:var(--blue)">↓ ${fmtSpeed(down)}</span>
        <span>${ico('archive', 12)} ${fmtBytes(size)}</span>
        <span>${ico('ratio', 12)} ${fmtRatio(ratio)}</span>
      </div></div>`;
  }).join('')}</div>`;
}
function storageAuditHTML() {
  return `<div class="section-title">存储审计</div><div class="grid-2">${state.servers.map(s => {
    const st = runtime.stats[s.id] || {};
    return `<div class="server-card"><div class="server-head"><span class="server-logo ${s.type === 'tr' ? 'tr' : 'qb'}">${s.type === 'tr' ? 'tr' : 'qb'}</span>${esc(s.name)}
      <span class="status-dot ${runtime.connection[s.id] === 'offline' ? 'off' : ''}"></span></div>
      <div style="font-size:11.5px;color:var(--secondary);margin-top:14px;word-break:break-all">${esc(st.savePath || '—')}</div>
      <div style="font-size:17px;font-weight:700;margin-top:4px">${fmtStorage(st.freeSpace || 0)}</div></div>`;
  }).join('')}</div>`;
}
function recentFinishedHTML() {
  const list = heroTasks().slice(0, 10);
  if (!list.length) return '';
  return `<div class="section-title">近期完成</div><div class="mini-list">${list.slice(0, 5).map(t => `
    <div class="mini-row">${posterHTML(t, true)}
      <span class="n">${esc(t.name)}</span><span class="v">${t.completedOn ? fmtRelative(t.completedOn) : fmtBytes(t.size)}</span>
    </div>`).join('')}</div>`;
}
function todayTransferHTML(a) {
  let dl = 0, ul = 0, at = 0;
  state.servers.forEach(s => {
    const b = runtime.baseline[s.id];
    const st = runtime.stats[s.id] || {};
    if (b) { dl += Math.max(0, (st.alltimeDL || 0) - b.dl); ul += Math.max(0, (st.alltimeUL || 0) - b.ul); at = Math.max(at, b.at); }
  });
  return `<div class="section-title">近期传输</div><div class="grid-2">
    ${statCard('download', '#0a84ff', fmtBytes(dl).split(' ')[0], fmtBytes(dl).split(' ')[1], '自基线起累计下载')}
    ${statCard('upload', '#34c759', fmtBytes(ul).split(' ')[0], fmtBytes(ul).split(' ')[1], '自基线起累计上传')}
  </div><div class="section-foot">基线时间：${at ? fmtDate(at) : '尚未建立'}　
    <a href="#" data-act="reset-baseline">重置基线</a></div>`;
}

export function topbar() {
  return `<div style="min-width:76px;font-size:16px;font-weight:750;letter-spacing:-.3px">OiiQT 🌊</div>
    <div class="topbar-title"></div>
    <div class="topbar-actions">
      <button class="icon-btn plain" data-act="dash-modules" title="模块设置">${ico('grid', 18)}</button>
      <button class="icon-btn plain" data-act="refresh" title="刷新">${ico('refresh', 18)}</button>
    </div>`;
}

export function html() {
  const mods = state.settings.dashboardModules || DEFAULT_MODULES;
  const a = agg();
  if (!state.servers.length) {
    return `<div class="page-title">仪表盘</div>
      <div class="hero"><div class="hero-slide on" style="background:linear-gradient(135deg,#7db9e8,#c9a7e8 55%,#f5b6a5)"></div>
        <div class="hero-shade"></div><div class="hero-caption"><div class="t">欢迎使用 OiiQT 🌊</div><div class="s">在手机上管理你的下载服务器</div></div></div>
      <div class="section-title">开始使用</div>
      <div class="list-group">
        <div class="row"><span class="row-ico" style="background:var(--blue)">${ico('server', 16)}</span><span class="row-txt"><span class="row-title">1. 添加下载器</span><span class="row-sub">支持 qBittorrent 与 Transmission</span></span></div>
        <div class="row"><span class="row-ico" style="background:var(--green)">${ico('globe', 16)}</span><span class="row-txt"><span class="row-title">2. 选择连接方式</span><span class="row-sub">PWA 建议用反代模式，或安装 APK 直连</span></span></div>
        <div class="row"><span class="row-ico" style="background:var(--orange)">${ico('list', 16)}</span><span class="row-txt"><span class="row-title">3. 开始管理</span><span class="row-sub">任务、限速、分类与 RSS 自动化</span></span></div>
      </div>
      <button class="btn btn-primary btn-block" data-act="add-server">${ico('plus', 16)} 添加服务器</button>
      <div class="section-foot">本项目参考 GPLv3 授权的 OiiQT (gangz1o) 重写，详见 README。</div>`;
  }
  const blocks = {
    posterWall: () => heroHTML(),
    liveTraffic: () => liveTrafficHTML(a),
    todayTransfer: () => todayTransferHTML(a),
    globalAssets: () => globalAssetsHTML(a),
    serverStatus: () => serverStatusHTML(),
    storageAudit: () => storageAuditHTML(),
    recentFinished: () => recentFinishedHTML()
  };
  return MODULES.filter(m => mods[m.k]).map(m => blocks[m.k]?.() || '').join('') +
    `<div class="refresh-note">${runtime.lastRefresh ? '更新于 ' + new Date(runtime.lastRefresh).toLocaleTimeString('zh-CN', { hour12: false }) : '正在连接服务器…'}</div>`;
}

export function onShow() { startHero(); }
export function onHide() { stopHero(); }
function stopHero() { if (heroTimer) clearInterval(heroTimer); heroTimer = null; }
function startHero() {
  stopHero();
  const n = heroTasks().length;
  if (n < 2) return;
  heroTimer = setInterval(() => {
    if (runtime.page !== 'dashboard' || document.visibilityState !== 'visible') return;
    runtime.heroIndex = (runtime.heroIndex + 1) % n;
    const hero = $('#hero');
    if (!hero) return;
    $$('.hero-slide', hero).forEach((s, i) => s.classList.toggle('on', i === runtime.heroIndex));
    $$('.hero-dots i', hero).forEach((d, i) => d.classList.toggle('on', i === runtime.heroIndex));
    const t = heroTasks()[runtime.heroIndex];
    const cap = $('.hero-caption', hero);
    if (t && cap) cap.innerHTML = `<div class="t">${esc(t.name)}</div><div class="s">${t.completedOn ? '完成于 ' + fmtRelative(t.completedOn) : esc(t.serverName || '')}</div>`;
  }, 5000);
}

export async function onAction(act, el) {
  if (act === 'dash-modules') return openModulesSheet();
  if (act === 'reset-baseline') {
    state.servers.forEach(s => {
      const st = runtime.stats[s.id] || {};
      runtime.baseline[s.id] = { dl: st.alltimeDL || 0, ul: st.alltimeUL || 0, at: Math.floor(Date.now() / 1000) };
    });
    const { saveBaseline } = await import('../store.js');
    saveBaseline(); toast('基线已重置', 'ok'); App.renderPage();
  }
}
function openModulesSheet() {
  const mods = state.settings.dashboardModules || DEFAULT_MODULES;
  openSheet({
    title: '仪表盘模块',
    body: `<div class="list-group">${MODULES.map(m => `<div class="row">
      <span class="row-ico" style="background:var(--blue)">${ico('chart', 15)}</span>
      <span class="row-txt"><span class="row-title">${m.n}</span></span>
      <button class="switch ${mods[m.k] ? 'on' : ''}" data-sheet-act="mod" data-k="${m.k}" type="button"></button>
    </div>`).join('')}</div>
    <div class="section-foot">关闭不常用的模块可以加快刷新速度。</div>`,
    actions: `<button class="btn" data-sheet-act="reset">恢复默认</button><button class="btn btn-primary" data-sheet-act="done">完成</button>`,
    onMount(root) {
      $$('[data-sheet-act="mod"]', root).forEach(b => b.onclick = () => {
        b.classList.toggle('on');
        mods[b.dataset.k] = b.classList.contains('on');
        state.settings.dashboardModules = mods; save();
      });
      root.querySelector('[data-sheet-act="reset"]').onclick = () => {
        state.settings.dashboardModules = { ...DEFAULT_MODULES }; save(); closeSheet(); App.renderPage();
      };
      root.querySelector('[data-sheet-act="done"]').onclick = () => { closeSheet(); App.renderPage(); };
    }
  });
}
