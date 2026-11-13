/* MoviePilot — instance management, discovery, search, detail & submit */
import { state, runtime, save } from '../store.js';
import { App } from '../core.js';
import {
  ico, esc, $, $$, fmtBytes, uid, toast, busy, openSheet, closeSheet,
  confirmSheet, debounce
} from '../util.js';
import { MoviePilot, MP_SOURCES, posterOf, titleOf, yearOf, mediaIdOf, mediaTypeOf } from '../clients/moviepilot.js';

runtime.mp = runtime.mp || { instanceId: '', source: 'douban_movies', query: '', items: [], page: 1, loading: false, resources: [], current: null };

function instances() { return state.settings.mpInstances || []; }
function activeInstance() {
  return instances().find(x => x.id === runtime.mp.instanceId) || instances()[0] || null;
}
function img(item) {
  const p = posterOf(item);
  const h = String(titleOf(item)).split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 5) % 360;
  return `<div class="poster" style="background:linear-gradient(140deg,hsl(${h},52%,72%),hsl(${(h + 60) % 360},52%,48%))">
    ${p ? `<img src="${esc(p)}" alt="" loading="lazy" onerror="this.style.display='none'">` : `<span class="ph">${esc(String(titleOf(item)).slice(0, 2))}</span>`}
    ${item.vote_average ? `<span class="res-badge" style="background:rgba(0,0,0,.55)">★ ${Number(item.vote_average).toFixed(1)}</span>` : ''}
  </div>`;
}

export function topbar() {
  return `<div style="min-width:76px"></div><div class="topbar-title">MoviePilot</div>
    <div class="topbar-actions">
      <button class="icon-btn plain" data-act="mp-settings" title="实例设置">${ico('gear', 18)}</button>
      <button class="icon-btn plain" data-act="mp-refresh" title="刷新">${ico('refresh', 18)}</button>
    </div>`;
}

export function html() {
  const inst = activeInstance();
  if (!inst) return `<div class="page-title">MoviePilot</div>
    <div class="empty"><div class="ico">${ico('film', 30)}</div><h3>连接你的 MoviePilot</h3>
      <p>配置实例地址与访问令牌后，即可浏览影视发现、搜索媒体并把资源提交到下载器。</p>
      <button class="btn btn-primary" data-act="mp-add">${ico('plus', 16)} 添加实例</button></div>
    <div class="banner info">可选功能。不配置 MoviePilot 完全不影响 qBittorrent / Transmission 的使用。</div>`;

  const mp = runtime.mp;
  return `<div class="page-title">影视发现</div>
  <div class="search-bar">${ico('search', 17)}<input id="mpSearch" data-input="mp-search" type="search" placeholder="搜索电影 / 剧集..." value="${esc(mp.query)}" autocomplete="off"></div>
  <div class="quick-row">${MP_SOURCES.map(s => `<button class="quick-pill ${mp.source === s.key && !mp.query ? 'active' : ''}" data-act="mp-source" data-k="${s.key}">${s.name}</button>`).join('')}</div>
  <div style="display:flex;align-items:center;gap:8px;margin:0 4px 10px" class="tiny muted">
    <span>${ico('server', 13)} ${esc(inst.name)}</span><span class="spacer"></span>
    <span>${mp.loading ? '加载中…' : mp.query ? `“${esc(mp.query)}” 的结果` : `${MP_SOURCES.find(s => s.key === mp.source)?.name || ''} · ${mp.items.length} 项`}</span>
  </div>
  ${mp.items.length ? `<div class="media-grid">${mp.items.map((it, i) => `<div class="media-card" data-act="mp-open" data-i="${i}">
      ${img(it)}<div class="n">${esc(titleOf(it))}</div><div class="y">${esc(yearOf(it))}${it.type ? ' · ' + esc(mediaTypeOf(it)) : ''}</div>
    </div>`).join('')}</div>`
    : `<div class="empty"><div class="ico">${ico('film', 30)}</div><h3>${mp.loading ? '正在加载…' : '暂无内容'}</h3>
        <p>${mp.loading ? '请稍候' : '试试切换发现源或搜索其他关键词。'}</p></div>`}
  ${mp.items.length ? `<div class="hstack" style="justify-content:center;gap:12px;margin:18px 0">
      <button class="btn btn-sm" data-act="mp-page" data-d="-1" ${mp.page <= 1 ? 'disabled' : ''}>上一页</button>
      <span class="tiny muted">第 ${mp.page} 页</span>
      <button class="btn btn-sm" data-act="mp-page" data-d="1">下一页</button></div>` : ''}`;
}

async function load(page = 1) {
  const inst = activeInstance(); if (!inst) return;
  runtime.mp.loading = true; runtime.mp.page = page;
  App.renderPage();
  try {
    const src = MP_SOURCES.find(s => s.key === runtime.mp.source) || MP_SOURCES[0];
    runtime.mp.items = runtime.mp.query.trim()
      ? await MoviePilot.mediaSearch(inst, runtime.mp.query.trim(), page)
      : await MoviePilot.discover(inst, src, page);
  } catch (e) {
    toast(e.message || '加载失败', 'err'); runtime.mp.items = [];
  } finally { runtime.mp.loading = false; App.renderPage(); }
}
const debouncedLoad = debounce(() => load(1), 500);

export function onShow() { if (activeInstance() && !runtime.mp.items.length) load(1); }
export function onInput(key, value) { if (key === 'mp-search') { runtime.mp.query = value; debouncedLoad(); } }

function instanceSheet(existing) {
  const i = existing || { id: uid(), name: '', address: '', token: '', allowInsecureSSL: false };
  openSheet({
    title: existing ? '编辑实例' : '添加 MoviePilot 实例',
    body: `<div class="field"><label>名称</label><input class="input" id="mpName" value="${esc(i.name)}" placeholder="例如：家里 MP"></div>
      <div class="field"><label>服务地址</label><input class="input" id="mpAddr" value="${esc(i.address)}" placeholder="http://192.168.1.10:3000"></div>
      <div class="field"><label>访问令牌 / API Key</label><input class="input" id="mpToken" value="${esc(i.token)}" placeholder="MoviePilot 设置中的 API Token">
        <div class="field-hint">会自动尝试 Bearer、X-API-KEY、?apikey= 与 ?token= 四种鉴权方式。</div></div>
      ${existing ? `<button class="btn btn-danger btn-block" data-sheet-act="del">删除实例</button>` : ''}`,
    actions: `<button class="btn" data-sheet-act="test">测试</button><button class="btn btn-primary" data-sheet-act="ok">保存</button>`,
    onMount(root) {
      const read = () => ({
        id: i.id, name: root.querySelector('#mpName').value.trim() || 'MoviePilot',
        address: root.querySelector('#mpAddr').value.trim(), token: root.querySelector('#mpToken').value.trim(),
        allowInsecureSSL: !!i.allowInsecureSSL
      });
      root.querySelector('[data-sheet-act="test"]').onclick = async () => {
        busy(true);
        try { await MoviePilot.test(read()); toast('连接成功', 'ok'); }
        catch (e) { toast(e.message || '连接失败', 'err'); } finally { busy(false); }
      };
      if (existing) root.querySelector('[data-sheet-act="del"]').onclick = () => {
        closeSheet(); confirmSheet('删除实例', '确定移除这个 MoviePilot 实例吗？', () => {
          state.settings.mpInstances = instances().filter(x => x.id !== existing.id);
          runtime.mp.instanceId = ''; save(); App.renderPage();
        });
      };
      root.querySelector('[data-sheet-act="ok"]').onclick = () => {
        const v = read();
        if (!v.address) { toast('请填写服务地址', 'err'); return; }
        if (existing) Object.assign(existing, v);
        else { state.settings.mpInstances = [...instances(), v]; runtime.mp.instanceId = v.id; }
        save(); closeSheet(); runtime.mp.items = []; load(1); toast('已保存', 'ok');
      };
    }
  });
}
function settingsSheet() {
  openSheet({
    title: 'MoviePilot 实例',
    body: `<div class="list-group">${instances().map(i => `<button class="row" data-sheet-act="pick" data-id="${esc(i.id)}" style="width:100%;text-align:left;background:transparent;color:var(--text)">
      <span class="row-ico" style="background:var(--indigo)">${ico('film', 16)}</span>
      <span class="row-txt"><span class="row-title">${esc(i.name)}</span><span class="row-sub">${esc(i.address)}</span></span>
      ${activeInstance()?.id === i.id ? `<span style="color:var(--blue)">${ico('check', 17)}</span>` : ''}</button>`).join('')}</div>
      <button class="btn btn-block" data-sheet-act="add" style="margin-top:12px">${ico('plus', 16)} 添加实例</button>`,
    onMount(root) {
      $$('[data-sheet-act="pick"]', root).forEach(b => b.onclick = () => {
        runtime.mp.instanceId = b.dataset.id; runtime.mp.items = []; closeSheet(); load(1);
      });
      root.querySelector('[data-sheet-act="add"]').onclick = () => { closeSheet(); instanceSheet(null); };
    }
  });
}

async function openDetail(item) {
  const inst = activeInstance(); if (!inst) return;
  runtime.mp.current = item;
  const d = { overview: item.overview || '', vote: item.vote_average || 0, poster: posterOf(item) };
  openSheet({
    title: titleOf(item),
    body: `<div style="display:flex;gap:12px;margin-bottom:14px">
        <div style="width:96px;flex:none">${img(item)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:16px;font-weight:700;line-height:1.35">${esc(titleOf(item))}</div>
          <div class="tiny muted" style="margin-top:5px">${esc(yearOf(item))} · ${esc(mediaTypeOf(item))} ${d.vote ? '· ★ ' + Number(d.vote).toFixed(1) : ''}</div>
          <div class="tag-row" style="margin-top:8px">${(item.genre_names || item.genreNames || []).slice(0, 3).map(g => `<span class="tag">${esc(g)}</span>`).join('')}</div>
        </div></div>
      <div style="font-size:12.5px;line-height:1.6;color:var(--text-2);margin-bottom:12px">${esc((d.overview || '暂无简介').slice(0, 260))}</div>
      <div class="section-title" style="font-size:16px">可用资源</div>
      <div id="mpRes"><div class="refresh-note">正在搜索资源…</div></div>`,
    actions: `<button class="btn" data-sheet-act="close">关闭</button>`,
    onMount(root) {
      root.querySelector('[data-sheet-act="close"]').onclick = closeSheet;
      MoviePilot.resources(inst, item).then(list => {
        runtime.mp.resources = list;
        const box = root.querySelector('#mpRes');
        if (!box) return;
        if (!list.length) { box.innerHTML = '<div class="banner">没有找到可用资源。</div>'; return; }
        box.innerHTML = `<div class="list-group">${list.slice(0, 30).map((r, i) => {
          const info = r.torrent_info || r;
          const name = info.title || info.name || r.title || r.name || '未命名资源';
          const size = info.size || r.size || 0;
          const site = info.site_name || info.site || r.site_name || '';
          const seed = info.seeders || info.seeders_count || r.seeders || '';
          return `<div class="row" style="align-items:flex-start"><span class="row-txt">
            <span class="row-title" style="white-space:normal;font-size:12.5px">${esc(name)}</span>
            <span class="row-sub">${esc(site)}${size ? ' · ' + (typeof size === 'number' ? fmtBytes(size) : esc(size)) : ''}${seed ? ' · 做种 ' + esc(seed) : ''}</span></span>
            <button class="btn btn-sm btn-primary" data-sheet-act="dl" data-i="${i}">下载</button></div>`;
        }).join('')}</div>`;
        $$('[data-sheet-act="dl"]', box).forEach(b => b.onclick = async () => {
          const r = list[Number(b.dataset.i)];
          const info = r.torrent_info || r;
          busy(true);
          try { await MoviePilot.addDownload(inst, info, {}); toast('已提交给 MoviePilot', 'ok'); }
          catch (e) { toast(e.message || '提交失败', 'err'); } finally { busy(false); }
        });
      }).catch(e => {
        const box = root.querySelector('#mpRes');
        if (box) box.innerHTML = `<div class="banner">资源搜索失败：${esc(e.message)}</div>`;
      });
    }
  });
}

export async function onAction(act, el) {
  switch (act) {
    case 'mp-add': return instanceSheet(null);
    case 'mp-settings': return settingsSheet();
    case 'mp-refresh': return load(runtime.mp.page || 1);
    case 'mp-source': runtime.mp.source = el.dataset.k; runtime.mp.query = ''; return load(1);
    case 'mp-page': return load(Math.max(1, (runtime.mp.page || 1) + Number(el.dataset.d)));
    case 'mp-open': return openDetail(runtime.mp.items[Number(el.dataset.i)]);
  }
}
