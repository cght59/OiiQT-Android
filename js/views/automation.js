/* Automation — RSS feeds, download rules, match preview & submit */
import { state, runtime, save } from '../store.js';
import { getClient } from '../clients/index.js';
import { request } from '../transport.js';
import { App } from '../core.js';
import {
  ico, esc, $, $$, fmtBytes, fmtRelative, uid, toast, busy, openSheet,
  closeSheet, confirmSheet
} from '../util.js';

runtime.rssTab = runtime.rssTab || 'feeds';

function textOf(node, sel) { const n = node.querySelector(sel); return n ? (n.textContent || '').trim() : ''; }
function parseFeed(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('RSS 内容无法解析');
  const nodes = [...doc.querySelectorAll('item, entry')];
  return nodes.map(n => {
    const enc = n.querySelector('enclosure');
    const linkEl = n.querySelector('link');
    const link = (linkEl && (linkEl.getAttribute('href') || linkEl.textContent)) || textOf(n, 'guid') || '';
    return {
      title: textOf(n, 'title') || '无标题',
      link: (link || '').trim(),
      enclosure: enc?.getAttribute('url') || '',
      size: Number(enc?.getAttribute('length') || 0),
      date: textOf(n, 'pubDate') || textOf(n, 'updated') || '',
      desc: (textOf(n, 'description') || textOf(n, 'summary') || '').replace(/<[^>]+>/g, '').slice(0, 160),
      guid: textOf(n, 'guid') || (link || '').trim() || textOf(n, 'title')
    };
  });
}
function kw(v) { return String(v || '').split(/[,，\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean); }
function matchesRule(rule, item) {
  const title = String(item.title || '').toLowerCase();
  const inc = kw(rule.include), exc = kw(rule.exclude);
  if (inc.length && !inc.every(k => title.includes(k))) return false;
  if (exc.length && exc.some(k => title.includes(k))) return false;
  if (rule.regex) { try { if (!new RegExp(rule.regex, 'i').test(item.title)) return false; } catch { return false; } }
  if (rule.season && !new RegExp(rule.season.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(item.title)) return false;
  if (rule.minSizeMB && item.size && item.size < rule.minSizeMB * 1024 * 1024) return false;
  if (rule.maxSizeMB && item.size && item.size > rule.maxSizeMB * 1024 * 1024) return false;
  return true;
}
function matchedItems() {
  const out = [];
  const rules = (state.settings.rssRules || []).filter(r => r.enabled !== false);
  Object.entries(runtime.rssItems || {}).forEach(([sid, items]) => {
    items.forEach(item => {
      rules.forEach(r => {
        if (r.sourceId && r.sourceId !== 'all' && r.sourceId !== sid) return;
        if (matchesRule(r, item)) out.push({ item, rule, sourceId: sid });
      });
    });
  });
  const seen = new Set();
  return out.filter(x => { const k = x.rule.id + '|' + x.item.guid; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function topbar() {
  return `<div style="min-width:76px"></div><div class="topbar-title">自动化</div>
    <div class="topbar-actions"><button class="icon-btn plain" data-act="rss-refresh" title="刷新订阅">${ico('refresh', 18)}</button></div>`;
}

export function html() {
  const tab = runtime.rssTab;
  const feeds = state.settings.rssSources || [];
  const rules = state.settings.rssRules || [];
  const hits = matchedItems();
  return `<div class="page-title">自动化</div>
  <div class="segmented" style="margin-bottom:14px">
    <button class="${tab === 'feeds' ? 'on' : ''}" data-act="rss-tab" data-k="feeds">订阅源 (${feeds.length})</button>
    <button class="${tab === 'rules' ? 'on' : ''}" data-act="rss-tab" data-k="rules">下载规则 (${rules.length})</button>
    <button class="${tab === 'matches' ? 'on' : ''}" data-act="rss-tab" data-k="matches">匹配结果 (${hits.length})</button>
  </div>
  ${tab === 'feeds' ? feedsHTML(feeds) : tab === 'rules' ? rulesHTML(rules) : matchesHTML(hits)}
  <button class="fab" data-act="rss-add" aria-label="添加">${ico('plus', 24)}</button>`;
}

function feedsHTML(feeds) {
  if (!feeds.length) return empty('rss', '还没有 RSS 订阅源', '添加站点提供的 RSS 链接，配合下载规则自动筛选资源。', '添加订阅源');
  return `<div class="list-group">${feeds.map(f => `<div class="row">
    <span class="row-ico" style="background:var(--orange)">${ico('rss', 16)}</span>
    <span class="row-txt"><span class="row-title">${esc(f.name)}</span><span class="row-sub">${esc(f.url)}</span></span>
    <button class="switch ${f.enabled !== false ? 'on' : ''}" data-act="rss-toggle-feed" data-id="${esc(f.id)}"></button>
    <button class="icon-btn plain" data-act="rss-edit-feed" data-id="${esc(f.id)}">${ico('edit', 15)}</button>
  </div>`).join('')}</div>
  <div class="section-foot">${ico('info', 12)} 订阅抓取走反向代理 / 原生请求，避免浏览器跨域限制。自动刷新仅在前台运行。</div>`;
}
function rulesHTML(rules) {
  if (!rules.length) return empty('filter', '还没有下载规则', '设置关键词、排除词和体积范围，匹配到的资源可一键提交到下载器。', '添加规则');
  return `<div class="list-group">${rules.map(r => `<div class="row">
    <span class="row-ico" style="background:var(--indigo)">${ico('filter', 16)}</span>
    <span class="row-txt"><span class="row-title">${esc(r.name)}</span>
      <span class="row-sub">${esc(r.include || '全部')}${r.exclude ? ' · 排除 ' + esc(r.exclude) : ''}${r.minSizeMB ? ' · ≥' + r.minSizeMB + 'MB' : ''}</span></span>
    <button class="switch ${r.enabled !== false ? 'on' : ''}" data-act="rss-toggle-rule" data-id="${esc(r.id)}"></button>
    <button class="icon-btn plain" data-act="rss-edit-rule" data-id="${esc(r.id)}">${ico('edit', 15)}</button>
  </div>`).join('')}</div>`;
}
function matchesHTML(hits) {
  if (!hits.length) return empty('checkCircle', '暂无匹配结果', '先添加订阅源与规则，然后点击右上角刷新按钮抓取。', '立即刷新');
  return `<div class="list-group">${hits.map((h, i) => `<div class="row" style="align-items:flex-start">
    <span class="row-ico" style="background:var(--green)">${ico('download', 16)}</span>
    <span class="row-txt"><span class="row-title" style="white-space:normal">${esc(h.item.title)}</span>
      <span class="row-sub">${esc(h.rule.name)} · ${h.item.size ? fmtBytes(h.item.size) : '大小未知'}</span></span>
    <button class="btn btn-sm btn-primary" data-act="rss-download" data-i="${i}">下载</button>
  </div>`).join('')}</div>`;
}
function empty(iconName, title, sub, btn) {
  return `<div class="empty"><div class="ico">${ico(iconName, 30)}</div><h3>${title}</h3><p>${sub}</p>
    <button class="btn btn-primary" data-act="${btn === '立即刷新' ? 'rss-refresh' : 'rss-add'}">${btn}</button></div>`;
}

async function fetchAll(showToast = true) {
  const feeds = (state.settings.rssSources || []).filter(f => f.enabled !== false);
  if (!feeds.length) { if (showToast) toast('请先添加并启用订阅源', 'err'); return; }
  busy(true); let n = 0, errs = 0;
  await Promise.all(feeds.map(async f => {
    try {
      const r = await request({ url: f.url, method: 'GET', jar: 'rss-' + f.id, timeout: 20000, headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } });
      if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
      runtime.rssItems[f.id] = parseFeed(r.text);
      f.lastFetch = Math.floor(Date.now() / 1000); f.lastError = '';
      n += runtime.rssItems[f.id].length;
    } catch (e) { f.lastError = e.message; errs++; }
  }));
  save(); busy(false);
  if (showToast) toast(errs ? `抓取完成，${errs} 个源失败` : `已抓取 ${n} 条资源`, errs ? 'err' : 'ok');
  App.renderPage();
}

/* ---------------- sheets ---------------- */
function feedSheet(existing) {
  const f = existing || { id: uid(), name: '', url: '', enabled: true };
  openSheet({
    title: existing ? '编辑订阅源' : '添加订阅源',
    body: `<div class="field"><label>名称</label><input class="input" id="rssName" value="${esc(f.name)}" placeholder="例如：某站影视区"></div>
      <div class="field"><label>RSS 地址</label><textarea class="textarea" id="rssUrl" placeholder="https://example.com/rss.php?..." style="min-height:70px">${esc(f.url)}</textarea>
        <div class="field-hint">支持 RSS 2.0 / Atom。含 passkey 的链接请勿截图外泄。</div></div>
      ${existing ? `<button class="btn btn-danger btn-block" data-sheet-act="del">删除此订阅源</button>` : ''}`,
    actions: `<button class="btn" data-sheet-act="cancel">取消</button><button class="btn btn-primary" data-sheet-act="ok">保存</button>`,
    onMount(root) {
      root.querySelector('[data-sheet-act="cancel"]').onclick = closeSheet;
      if (existing) root.querySelector('[data-sheet-act="del"]').onclick = () => {
        closeSheet(); confirmSheet('删除订阅源', '同时会清除已抓取的条目缓存。', () => {
          state.settings.rssSources = state.settings.rssSources.filter(x => x.id !== existing.id);
          state.settings.rssRules = state.settings.rssRules.filter(r => r.sourceId !== existing.id);
          delete runtime.rssItems[existing.id]; save(); App.renderPage();
        });
      };
      root.querySelector('[data-sheet-act="ok"]').onclick = () => {
        f.name = root.querySelector('#rssName').value.trim() || '未命名订阅';
        f.url = root.querySelector('#rssUrl').value.trim();
        if (!/^https?:\/\//i.test(f.url)) { toast('请填写完整 URL', 'err'); return; }
        if (!existing) state.settings.rssSources.push(f);
        save(); closeSheet(); App.renderPage(); toast('已保存', 'ok');
      };
    }
  });
}

function ruleSheet(existing) {
  const r = existing || {
    id: uid(), name: '', sourceId: 'all', include: '', exclude: '', regex: '', season: '',
    minSizeMB: 0, maxSizeMB: 0, serverId: state.servers[0]?.id || '', savePath: '',
    category: '', tags: '', enabled: true
  };
  openSheet({
    title: existing ? '编辑下载规则' : '添加下载规则',
    body: `<div class="field"><label>规则名称</label><input class="input" id="rlName" value="${esc(r.name)}" placeholder="例如：4K 电影"></div>
      <div class="field"><label>订阅源</label><select class="select" id="rlSource">
        <option value="all">全部订阅源</option>
        ${(state.settings.rssSources || []).map(f => `<option value="${esc(f.id)}" ${r.sourceId === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}
      </select></div>
      <div class="field"><label>包含关键词（空格或逗号分隔，全部命中）</label><input class="input" id="rlInc" value="${esc(r.include)}" placeholder="2160p WEB-DL"></div>
      <div class="field"><label>排除关键词（任一命中即排除）</label><input class="input" id="rlExc" value="${esc(r.exclude)}" placeholder="HDR DV 国语"></div>
      <div class="field"><label>正则表达式（可选）</label><input class="input" id="rlRegex" value="${esc(r.regex)}" placeholder="S0[1-3]E\\d{2}"></div>
      <div class="hstack" style="gap:10px">
        <div class="field" style="flex:1"><label>最小体积 (MB)</label><input class="input" id="rlMin" type="number" min="0" value="${r.minSizeMB || 0}"></div>
        <div class="field" style="flex:1"><label>最大体积 (MB)</label><input class="input" id="rlMax" type="number" min="0" value="${r.maxSizeMB || 0}"></div>
      </div>
      <div class="field"><label>目标服务器</label><select class="select" id="rlServer">
        ${state.servers.map(s => `<option value="${esc(s.id)}" ${r.serverId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      </select></div>
      <div class="field"><label>保存路径（可选）</label><input class="input" id="rlPath" value="${esc(r.savePath || '')}"></div>
      <div class="field"><label>分类 / 标签（可选，逗号分隔）</label><input class="input" id="rlTags" value="${esc(r.tags || '')}"></div>
      ${existing ? `<button class="btn btn-danger btn-block" data-sheet-act="del">删除此规则</button>` : ''}`,
    actions: `<button class="btn" data-sheet-act="cancel">取消</button><button class="btn btn-primary" data-sheet-act="ok">保存</button>`,
    onMount(root) {
      root.querySelector('[data-sheet-act="cancel"]').onclick = closeSheet;
      if (existing) root.querySelector('[data-sheet-act="del"]').onclick = () => {
        closeSheet(); confirmSheet('删除规则', '确定删除这条下载规则吗？', () => {
          state.settings.rssRules = state.settings.rssRules.filter(x => x.id !== existing.id);
          save(); App.renderPage();
        });
      };
      root.querySelector('[data-sheet-act="ok"]').onclick = () => {
        Object.assign(r, {
          name: root.querySelector('#rlName').value.trim() || '未命名规则',
          sourceId: root.querySelector('#rlSource').value,
          include: root.querySelector('#rlInc').value, exclude: root.querySelector('#rlExc').value,
          regex: root.querySelector('#rlRegex').value, season: '',
          minSizeMB: Number(root.querySelector('#rlMin').value) || 0,
          maxSizeMB: Number(root.querySelector('#rlMax').value) || 0,
          serverId: root.querySelector('#rlServer').value,
          savePath: root.querySelector('#rlPath').value.trim(),
          tags: root.querySelector('#rlTags').value.trim()
        });
        if (!existing) state.settings.rssRules.push(r);
        save(); closeSheet(); App.renderPage(); toast('已保存', 'ok');
      };
    }
  });
}

export async function onAction(act, el) {
  switch (act) {
    case 'rss-tab': runtime.rssTab = el.dataset.k; App.renderPage(); return;
    case 'rss-refresh': return fetchAll();
    case 'rss-add': return runtime.rssTab === 'feeds' ? feedSheet(null) : runtime.rssTab === 'rules' ? ruleSheet(null) : fetchAll();
    case 'rss-edit-feed': return feedSheet((state.settings.rssSources || []).find(f => f.id === el.dataset.id));
    case 'rss-edit-rule': return ruleSheet((state.settings.rssRules || []).find(r => r.id === el.dataset.id));
    case 'rss-toggle-feed': {
      const f = state.settings.rssSources.find(x => x.id === el.dataset.id);
      if (f) { f.enabled = f.enabled === false; save(); App.renderPage(); } return;
    }
    case 'rss-toggle-rule': {
      const r = state.settings.rssRules.find(x => x.id === el.dataset.id);
      if (r) { r.enabled = r.enabled === false; save(); App.renderPage(); } return;
    }
    case 'rss-download': {
      const h = matchedItems()[Number(el.dataset.i)];
      if (!h) return;
      const sv = state.servers.find(s => s.id === h.rule.serverId) || state.servers[0];
      if (!sv) { toast('请先添加服务器', 'err'); return; }
      const url = h.item.enclosure || h.item.link;
      if (!url) { toast('该条目没有可用的种子链接', 'err'); return; }
      busy(true);
      try {
        await getClient(sv).addTorrent({
          urls: [url], files: [],
          options: {
            savePath: h.rule.savePath, category: h.rule.category,
            tags: String(h.rule.tags || '').split(',').map(x => x.trim()).filter(Boolean)
          }
        });
        toast('已提交到 ' + sv.name, 'ok'); App.go('transfers'); await App.refresh(true);
      } catch (e) { toast(e.message || '提交失败', 'err'); }
      finally { busy(false); }
      return;
    }
  }
}
