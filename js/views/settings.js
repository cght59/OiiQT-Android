/* Settings — servers, connection, appearance, extensions, limits, data */
import { state, runtime, save, addServer, removeServer, getServer, exportConfig, importConfig } from '../store.js';
import { getClient, invalidateClients } from '../clients/index.js';
import { resetJar, currentMode, invalidateMode } from '../transport.js';
import { App } from '../core.js';
import {
  ico, esc, $, $$, fmtSpeed, uid, toast, busy, openSheet, closeSheet,
  confirmSheet, promptSheet
} from '../util.js';

const row = (iconName, color, title, sub, act, value = '', id = '') => `
  <div class="row" ${act ? `data-act="${act}" data-id="${esc(id)}"` : ''} role="button">
    <span class="row-ico" style="background:${color}">${ico(iconName, 16)}</span>
    <span class="row-txt"><span class="row-title">${esc(title)}</span>${sub ? `<span class="row-sub">${esc(sub)}</span>` : ''}</span>
    ${value ? `<span class="row-value">${esc(value)}</span>` : ''}
    ${act ? `<span class="chevron">${ico('right', 15)}</span>` : ''}
  </div>`;

export function topbar() {
  return `<div style="min-width:76px"></div><div class="topbar-title">设置</div>
    <div class="topbar-actions"><button class="icon-btn plain" data-act="settings-about" title="关于">${ico('info', 18)}</button></div>`;
}

export function html() {
  const s = state.settings;
  const mode = s.transport;
  const modeName = { auto: '自动', proxy: '反向代理', direct: '直连', native: '原生 (APK)' }[mode] || '自动';
  const themeName = { auto: '跟随系统', light: '浅色', dark: '深色' }[s.theme] || '跟随系统';
  return `<div class="page-title">设置</div>

  <div class="section-title">服务器设置</div>
  <div class="list-group">
    ${state.servers.length ? state.servers.map(sv => {
      const conn = runtime.connection[sv.id] || 'pending';
      return `<div class="row" data-act="edit-server" data-id="${esc(sv.id)}" role="button">
        <span class="server-logo ${sv.type === 'tr' ? 'tr' : 'qb'}" style="width:30px;height:30px;font-size:12px">${sv.type === 'tr' ? 'tr' : 'qb'}</span>
        <span class="row-txt"><span class="row-title">${esc(sv.name)}</span>
          <span class="row-sub">${esc(sv.address)}:${sv.port} · ${sv.type === 'tr' ? 'Transmission' : 'qBittorrent'}</span></span>
        <span class="status-dot ${conn === 'online' ? '' : conn === 'offline' ? 'off' : 'pending'}"></span>
        <span class="chevron">${ico('right', 15)}</span></div>`;
    }).join('') : `<div class="row"><span class="row-txt"><span class="row-title muted">还没有服务器</span></span></div>`}
    <div class="row" data-act="add-server" role="button"><span class="row-ico" style="background:var(--blue)">${ico('plus', 16)}</span>
      <span class="row-txt"><span class="row-title" style="color:var(--blue)">添加服务器</span></span></div>
  </div>

  <div class="section-title">连接与网络</div>
  <div class="list-group">
    ${row('globe', '#0a84ff', '请求方式', '浏览器受 CORS 限制，建议使用反代或 APK', 'set-transport', modeName)}
    ${row('link', '#30b0c7', '反向代理地址', s.proxyBase || '留空 = 同源 /proxy（推荐）', 'set-proxy-base', s.proxyBase ? '自定义' : '同源')}
    ${row('shield', '#34c759', '允许自签证书', '仅反向代理 / 原生模式有效', 'toggle-insecure', s.allowInsecureSSL ? '已开启' : '已关闭')}
    ${row('refresh', '#af52de', '自动刷新间隔', '仪表盘与任务列表的轮询周期', 'set-refresh', s.refreshInterval + ' 秒')}
    ${row('layers', '#ff9f0a', '聚合所有服务器', '关闭后仅显示当前选中服务器', 'toggle-aggregate', s.aggregate ? '开启' : '关闭')}
    ${row('wifiOff', '#ff453a', '测试全部连接', '依次检查每台服务器', 'test-all')}
  </div>
  <div class="section-foot">当前实际请求方式：<b id="curMode">检测中…</b>。若提示跨域错误，请先启动随附的 Node 服务（自带 /proxy 反向代理），或安装 APK 使用原生请求。</div>

  <div class="section-title">外观与个性化</div>
  <div class="list-group">
    ${row('image', '#5856d6', '外观', '', 'set-theme', themeName)}
    ${row('eyeOff', '#8a8a8e', '隐藏节点名称', '隐藏 Tracker 主机名，仅显示别名', 'toggle-hide-nodes', s.hideNodeNames ? '开启' : '关闭')}
    ${row('star', '#ff2d55', 'TMDB API Key', s.tmdbKey ? '已配置 · 用于匹配影视海报' : '可选，填写后自动匹配海报', 'set-tmdb', s.tmdbKey ? '••••••••' : '未设置')}
    ${row('image', '#30b0c7', '立即匹配海报', `为最近 ${Math.min(20, runtime.tasks.length)} 个任务匹配`, 'match-posters')}
    ${row('link', '#00c7be', 'Tracker 别名', `${Object.keys(s.trackerAliases || {}).length} 条`, 'tracker-aliases')}
    ${row('folder', '#ff9f0a', '预设保存路径', `${(s.presetPaths || []).length} 条`, 'preset-paths')}
  </div>

  <div class="section-title">速度限制</div>
  <div class="list-group">
    ${row('gauge', '#af52de', '全局限速', '设置每台服务器的下载 / 上传上限', 'global-limits')}
    ${row('download', '#0a84ff', '下载服务器设置', 'qB / TR 连接设置需在各自 Web UI 开启', 'connection-help')}
  </div>

  <div class="section-title">数据</div>
  <div class="list-group">
    ${row('upload', '#34c759', '导出配置', '含服务器、别名与偏好设置', 'export-config')}
    ${row('download', '#0a84ff', '导入配置', '从 JSON 文件恢复', 'import-config')}
    ${row('trash', '#ff3b30', '清除所有本地数据', '包含服务器与凭据', 'clear-data')}
  </div>

  <div class="section-foot" style="text-align:center;padding:18px 0 6px">
    OiiQT for Android · 参考 <a href="https://github.com/gangz1o/OiiQT" target="_blank" rel="noopener">gangz1o/OiiQT</a> 重写<br>
    GPL-3.0 · 无会员、无内购、不限制服务器数量
  </div>`;
}

export async function onShow() {
  currentMode().then(m => {
    const n = $('#curMode');
    if (n) n.textContent = { proxy: '反向代理 ✓', direct: '直连（可能受 CORS 限制）', native: '原生 HTTP ✓' }[m] || m;
  });
}

/* ---------------- server editor ---------------- */
export function openServerEditor(existing) {
  const s = existing || { id: uid(), name: '', type: 'qb', address: '', port: 8080, username: '', password: '', useHTTPS: false, allowInsecureSSL: false, rpcPath: '/api/v2' };
  openSheet({
    title: existing ? '编辑服务器' : '添加服务器',
    body: `
      <div class="field"><label>显示名称</label><input class="input" id="svName" value="${esc(s.name)}" placeholder="例如：家里的 NAS"></div>
      <div class="field"><label>下载器类型</label>
        <select class="select" id="svType">
          <option value="qb" ${s.type !== 'tr' ? 'selected' : ''}>qBittorrent</option>
          <option value="tr" ${s.type === 'tr' ? 'selected' : ''}>Transmission</option>
        </select></div>
      <div class="field"><label>地址</label><input class="input" id="svAddr" value="${esc(s.address)}" placeholder="192.168.1.10 或 nas.example.com" autocomplete="off" autocapitalize="off"></div>
      <div class="hstack" style="gap:10px">
        <div class="field" style="flex:1"><label>端口</label><input class="input" id="svPort" type="number" value="${s.port || 8080}"></div>
        <div class="field" style="flex:1"><label>协议</label><select class="select" id="svHttps">
          <option value="0" ${!s.useHTTPS ? 'selected' : ''}>HTTP</option><option value="1" ${s.useHTTPS ? 'selected' : ''}>HTTPS</option>
        </select></div>
      </div>
      <div class="field"><label>用户名</label><input class="input" id="svUser" value="${esc(s.username || '')}" autocomplete="off"></div>
      <div class="field"><label>密码</label><input class="input" id="svPass" type="password" value="${esc(s.password || '')}" autocomplete="new-password"></div>
      <div class="field"><label>API / RPC 路径</label><input class="input" id="svPath" value="${esc(s.rpcPath || '')}" placeholder="/api/v2 或 /transmission/rpc">
        <div class="field-hint">反向代理部署时填写实际路径。qBittorrent 默认 /api/v2，Transmission 默认 /transmission/rpc。</div></div>
      <div class="list-group" style="margin-bottom:6px">
        <div class="row"><span class="row-txt"><span class="row-title">允许自签 SSL 证书</span></span>
          <button class="switch ${s.allowInsecureSSL ? 'on' : ''}" data-sheet-act="ssl" type="button"></button></div>
        <div class="row"><span class="row-txt"><span class="row-title">在本机保存密码</span>
          <span class="row-sub">关闭后密码仅在当前浏览器会话有效</span></span>
          <button class="switch ${state.settings.savePassword ? 'on' : ''}" data-sheet-act="savepwd" type="button"></button></div>
      </div>
      <div id="testResult" class="banner info hidden"></div>`,
    actions: `${existing ? '<button class="btn btn-danger" data-sheet-act="del">删除</button>' : ''}
      <button class="btn" data-sheet-act="test">测试连接</button>
      <button class="btn btn-primary" data-sheet-act="save">保存</button>`,
    onMount(root) {
      const typeSel = root.querySelector('#svType'), portInput = root.querySelector('#svPort'), pathInput = root.querySelector('#svPath');
      let pathTouched = !!existing;
      typeSel.onchange = () => {
        const tr = typeSel.value === 'tr';
        portInput.value = tr ? 9091 : 8080;
        if (!pathTouched) pathInput.value = tr ? '/transmission/rpc' : '/api/v2';
      };
      pathInput.oninput = () => { pathTouched = true; };
      let ssl = !!s.allowInsecureSSL;
      root.querySelector('[data-sheet-act="ssl"]').onclick = (e) => { ssl = !ssl; e.currentTarget.classList.toggle('on', ssl); };
      root.querySelector('[data-sheet-act="savepwd"]').onclick = (e) => {
        state.settings.savePassword = !state.settings.savePassword;
        e.currentTarget.classList.toggle('on', state.settings.savePassword); save();
      };
      const read = () => ({
        id: s.id, name: root.querySelector('#svName').value.trim() || '未命名服务器',
        type: typeSel.value, address: root.querySelector('#svAddr').value.trim(),
        port: Number(root.querySelector('#svPort').value) || (typeSel.value === 'tr' ? 9091 : 8080),
        username: root.querySelector('#svUser').value, password: root.querySelector('#svPass').value,
        useHTTPS: root.querySelector('#svHttps').value === '1',
        allowInsecureSSL: ssl, rpcPath: pathInput.value.trim() || (typeSel.value === 'tr' ? '/transmission/rpc' : '/api/v2')
      });
      const showResult = (msg, ok) => {
        const box = root.querySelector('#testResult');
        box.className = 'banner ' + (ok ? 'info' : '');
        box.textContent = msg; box.classList.remove('hidden');
      };
      root.querySelector('[data-sheet-act="test"]').onclick = async () => {
        const v = read();
        if (!v.address) { showResult('请先填写地址', false); return; }
        showResult('正在连接…', true); busy(true);
        try {
          const r = await getClient({ ...v, id: 'test-' + v.id }).test();
          showResult(`连接成功 · 服务端版本 ${r.version || '未知'}`, true);
        } catch (e) { showResult('连接失败：' + (e.message || '未知错误'), false); }
        finally { busy(false); }
      };
      root.querySelector('[data-sheet-act="save"]').onclick = async () => {
        const v = read();
        if (!v.address) { showResult('请先填写地址', false); return; }
        if (existing) Object.assign(existing, v); else addServer(v);
        save(); invalidateClients(); await resetJar(v.id); invalidateMode();
        closeSheet(); toast('已保存', 'ok'); await App.refresh();
      };
      if (existing) root.querySelector('[data-sheet-act="del"]').onclick = () => {
        const id = existing.id;
        closeSheet();
        confirmSheet('删除服务器', `确定删除「${existing.name}」吗？本地配置将被移除（下载器上的任务不受影响）。`, async () => {
          removeServer(id); invalidateClients(); await resetJar(id); toast('已删除', 'ok'); await App.refresh();
        });
      };
    }
  });
}

/* ---------------- simple sheets ---------------- */
function optionSheet(title, options, current, onPick) {
  openSheet({
    title,
    body: `<div class="list-group">${options.map(o => `<button class="row" data-sheet-act="o" data-v="${esc(o.k)}" style="width:100%;text-align:left;background:transparent;color:var(--text)">
      <span class="row-txt"><span class="row-title">${esc(o.n)}</span>${o.d ? `<span class="row-sub">${esc(o.d)}</span>` : ''}</span>
      ${current === o.k ? `<span style="color:var(--blue)">${ico('check', 17)}</span>` : ''}</button>`).join('')}</div>`,
    onMount(root) {
      $$('[data-sheet-act="o"]', root).forEach(b => b.onclick = () => { closeSheet(); onPick(b.dataset.v); });
    }
  });
}

function openGlobalLimits() {
  if (!state.servers.length) { toast('请先添加服务器', 'err'); return; }
  const sel = state.servers[0];
  openSheet({
    title: '全局限速',
    body: `<div class="field"><label>服务器</label><select class="select" id="glServer">${state.servers.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></div>
      <div class="banner info" id="glCur">读取中…</div>
      <div class="field"><label>下载上限 (KB/s，0 = 不限)</label><input class="input" id="glDl" type="number" min="0" value="0"></div>
      <div class="field"><label>上传上限 (KB/s，0 = 不限)</label><input class="input" id="glUl" type="number" min="0" value="0"></div>
      <div class="field-hint">qBittorrent 走 transfer/set*Limit；Transmission 走 session-set。不同下载器的备用限速策略略有差异。</div>`,
    actions: `<button class="btn" data-sheet-act="cancel">取消</button><button class="btn btn-primary" data-sheet-act="ok">保存</button>`,
    onMount(root) {
      const selEl = root.querySelector('#glServer'), box = root.querySelector('#glCur');
      const load = async () => {
        const s = getServer(selEl.value);
        box.textContent = '读取中…';
        try {
          const c = getClient(s), l = await c.globalLimits();
          root.querySelector('#glDl').value = Math.round((l.dlLimit || 0) / 1024);
          root.querySelector('#glUl').value = Math.round((l.upLimit || 0) / 1024);
          box.textContent = `当前：↓ ${fmtSpeed(l.dlLimit)} / ↑ ${fmtSpeed(l.upLimit)}${l.scheduler ? ' · 已启用计划限速' : ''}`;
        } catch (e) { box.textContent = '读取失败：' + e.message; }
      };
      selEl.onchange = load; load();
      root.querySelector('[data-sheet-act="cancel"]').onclick = closeSheet;
      root.querySelector('[data-sheet-act="ok"]').onclick = async () => {
        const s = getServer(selEl.value), c = getClient(s);
        const dl = Number(root.querySelector('#glDl').value) || 0;
        const ul = Number(root.querySelector('#glUl').value) || 0;
        closeSheet(); busy(true);
        try {
          await Promise.all([c.setGlobalDownloadLimit(dl * 1024), c.setGlobalUploadLimit(ul * 1024)]);
          toast('全局限速已保存', 'ok');
        } catch (e) { toast(e.message, 'err'); } finally { busy(false); }
      };
    }
  });
}

function openTrackerAliases() {
  const a = state.settings.trackerAliases || {};
  openSheet({
    title: 'Tracker 别名',
    body: `<div class="banner info">把难记的 Tracker 域名替换成短名称，例如 m-team.cc → 馒头。</div>
      <div class="list-group" id="aliasList">${Object.entries(a).map(([k, v]) => `<div class="row" data-k="${esc(k)}">
        <span class="row-txt"><span class="row-title">${esc(v)}</span><span class="row-sub">${esc(k)}</span></span>
        <button class="btn btn-sm btn-danger" data-sheet-act="del" data-k="${esc(k)}">删除</button></div>`).join('') || '<div class="row"><span class="muted">暂无别名</span></div>'}</div>`,
    actions: `<button class="btn" data-sheet-act="add">添加别名</button><button class="btn btn-primary" data-sheet-act="done">完成</button>`,
    onMount(root) {
      const bind = () => $$('[data-sheet-act="del"]', root).forEach(b => b.onclick = () => {
        delete state.settings.trackerAliases[b.dataset.k]; save(); b.closest('.row').remove();
      });
      bind();
      root.querySelector('[data-sheet-act="add"]').onclick = () => {
        closeSheet();
        promptSheet({
          title: '添加别名', label: '域名 → 别名（用 = 分隔）', placeholder: 'm-team.cc = 馒头',
          hint: '也可以只填域名，之后在列表里编辑显示名', confirmLabel: '添加',
          onConfirm: (v) => {
            const [host, ...rest] = v.split('=');
            if (!host.trim()) return;
            state.settings.trackerAliases[host.trim().toLowerCase()] = (rest.join('=').trim() || host.trim());
            save(); toast('已添加', 'ok'); App.renderPage();
          }
        });
      };
      root.querySelector('[data-sheet-act="done"]').onclick = () => { closeSheet(); App.renderPage(); };
    }
  });
}

function openPresetPaths() {
  openSheet({
    title: '预设保存路径',
    body: `<div class="field"><label>每行一个绝对路径</label>
      <textarea class="textarea" id="ppList" placeholder="/PT/Seeding&#10;/downloads/movies">${esc((state.settings.presetPaths || []).join('\n'))}</textarea></div>
      <div class="field-hint">添加任务时会在保存路径输入框中提供自动补全。</div>`,
    actions: `<button class="btn" data-sheet-act="cancel">取消</button><button class="btn btn-primary" data-sheet-act="ok">保存</button>`,
    onMount(root) {
      root.querySelector('[data-sheet-act="cancel"]').onclick = closeSheet;
      root.querySelector('[data-sheet-act="ok"]').onclick = () => {
        state.settings.presetPaths = root.querySelector('#ppList').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
        save(); closeSheet(); toast('已保存', 'ok');
      };
    }
  });
}

function openAbout() {
  openSheet({
    title: '关于',
    body: `<div style="text-align:center;padding:12px 0 20px">
        <div style="font-size:40px">🌊</div>
        <div style="font-size:20px;font-weight:750;margin-top:6px">OiiQT for Android</div>
        <div class="muted tiny" style="margin-top:4px">非官方跨平台重写 · v1.0.0</div>
      </div>
      <div class="list-group" style="padding:6px 14px">
        <div class="kv"><span class="k">原项目</span><span class="v">gangz1o/OiiQT (iOS, SwiftUI)</span></div>
        <div class="kv"><span class="k">许可</span><span class="v">GPL-3.0</span></div>
        <div class="kv"><span class="k">服务器数量</span><span class="v">不限</span></div>
        <div class="kv"><span class="k">会员 / 内购</span><span class="v">无</span></div>
      </div>
      <div class="banner info" style="margin-top:14px">本项目不提供、也不托管任何下载服务器。所有请求直接从你的设备发往你自己配置的 qBittorrent / Transmission / MoviePilot 实例。</div>
      <div class="section-foot">原项目 © gangz1o，遵循 GNU GPL v3。本重写实现参考了其 API 契约与交互设计，未复制其 Swift 源码或品牌素材。</div>`,
    onMount(root) {
      const b = document.createElement('button');
      b.className = 'btn btn-block'; b.style.marginTop = '10px';
      b.textContent = '查看原项目';
      b.onclick = () => window.open('https://github.com/gangz1o/OiiQT', '_blank', 'noopener');
      root.querySelector('.sheet-body').appendChild(b);
    }
  });
}

function exportToFile() {
  const blob = new Blob([exportConfig()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'oiiqt-config-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('配置已导出', 'ok');
}
function importFromFile() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files?.[0]; if (!f) return;
    try {
      importConfig(await f.text());
      invalidateClients(); invalidateMode(); toast('配置已导入', 'ok'); await App.refresh();
    } catch (e) { toast('导入失败：' + e.message, 'err'); }
  };
  inp.click();
}

export async function onAction(act, el) {
  switch (act) {
    case 'add-server': return openServerEditor(null);
    case 'edit-server': return openServerEditor(getServer(el.dataset.id));
    case 'settings-about': return openAbout();
    case 'set-theme': return optionSheet('外观', [
      { k: 'auto', n: '跟随系统' }, { k: 'light', n: '浅色' }, { k: 'dark', n: '深色' }
    ], state.settings.theme, v => { state.settings.theme = v; save(); App.applyTheme(); App.renderPage(); });
    case 'set-transport': return optionSheet('请求方式', [
      { k: 'auto', n: '自动（推荐）', d: 'APK 用原生请求；网页检测到 /proxy 时自动走反代' },
      { k: 'proxy', n: '反向代理', d: '由随附的 Node 服务转发，彻底绕过 CORS' },
      { k: 'direct', n: '直连', d: '要求下载器或反向代理已开放 CORS' },
      { k: 'native', n: '原生 (APK)', d: 'CapacitorHttp，无跨域限制' }
    ], state.settings.transport, v => {
      state.settings.transport = v; save(); invalidateMode(); invalidateClients(); App.refresh();
      toast('请求方式已切换，正在重新连接…');
    });
    case 'set-proxy-base': return promptSheet({
      title: '反向代理地址', label: '完整 URL（含 /proxy 路径）',
      value: state.settings.proxyBase || '',
      placeholder: 'http://192.168.1.10:8787/proxy',
      hint: '留空则使用当前站点的同源 /proxy。APK 内若原生请求遇到鉴权问题，可指向你自建的 Node 代理。',
      onConfirm: v => {
        state.settings.proxyBase = v.trim(); save(); invalidateMode(); invalidateClients();
        App.renderPage(); toast('已保存，正在重新连接…');
        App.refresh();
      }
    });
    case 'set-refresh': return optionSheet('自动刷新间隔', [
      { k: '3', n: '3 秒' }, { k: '5', n: '5 秒（默认）' }, { k: '10', n: '10 秒' },
      { k: '20', n: '20 秒' }, { k: '30', n: '30 秒' }
    ], String(state.settings.refreshInterval), v => {
      state.settings.refreshInterval = Number(v); save(); App.restartTimer(); App.renderPage();
    });
    case 'toggle-aggregate': state.settings.aggregate = !state.settings.aggregate; save(); App.renderPage(); return;
    case 'toggle-insecure': state.settings.allowInsecureSSL = !state.settings.allowInsecureSSL; save(); App.renderPage(); return;
    case 'toggle-hide-nodes': state.settings.hideNodeNames = !state.settings.hideNodeNames; save(); App.renderPage(); return;
    case 'set-tmdb': return promptSheet({
      title: 'TMDB API Key', label: 'API Key (v3 auth)', value: state.settings.tmdbKey || '',
      hint: '在 themoviedb.org 设置页免费申请。留空则不加载海报。密钥仅保存在本机。',
      onConfirm: v => { state.settings.tmdbKey = v.trim(); save(); App.renderPage(); toast(state.settings.tmdbKey ? '已保存' : '已清除', 'ok'); }
    });
    case 'match-posters': {
      if (!state.settings.tmdbKey) { toast('请先设置 TMDB API Key', 'err'); return; }
      toast('正在匹配海报…');
      const { matchPosters } = await import('../posters.js');
      const n = await matchPosters(runtime.tasks.slice(0, 20), 8);
      toast(n ? `已匹配 ${n} 个任务` : '没有需要匹配的任务', 'ok'); App.renderPage(); return;
    }
    case 'tracker-aliases': return openTrackerAliases();
    case 'preset-paths': return openPresetPaths();
    case 'global-limits': return openGlobalLimits();
    case 'connection-help': return openSheet({
      title: '下载器准备',
      body: `<div class="banner info">手机端只负责管理，实际下载由你的服务器完成。</div>
        <div class="section-title" style="font-size:16px">qBittorrent</div>
        <div class="list-group" style="padding:8px 14px;font-size:13px;line-height:1.7">
          1. 打开「工具 → 选项 → Web UI」并启用<br>2. 记下端口（默认 8080）与用户名/密码<br>3. 如使用反向代理，请填写实际的 API 路径</div>
        <div class="section-title" style="font-size:16px">Transmission</div>
        <div class="list-group" style="padding:8px 14px;font-size:13px;line-height:1.7">
          1. 启用 RPC（默认端口 9091，路径 /transmission/rpc）<br>2. 设置 RPC 用户名与密码，或关闭认证<br>3. 若从外网访问，建议经 HTTPS 反向代理</div>
        <div class="section-foot">浏览器直连通常需要目标服务返回 CORS 头；本项目的 Node 服务或 APK 已内置解决方案。</div>`
    });
    case 'test-all': {
      if (!state.servers.length) { toast('请先添加服务器', 'err'); return; }
      busy(true); let ok = 0;
      for (const s of state.servers) {
        try { await getClient(s).test(); runtime.connection[s.id] = 'online'; ok++; }
        catch (e) { runtime.connection[s.id] = 'offline'; toast(`${s.name}: ${e.message}`, 'err'); }
      }
      busy(false); toast(`连接测试完成：${ok}/${state.servers.length} 在线`, ok ? 'ok' : 'err'); App.renderPage(); return;
    }
    case 'export-config': return exportToFile();
    case 'import-config': return importFromFile();
    case 'clear-data': return confirmSheet('清除所有数据', '将删除本机保存的全部服务器、凭据、RSS 规则与偏好设置。此操作不可撤销，建议先导出配置。', () => {
      localStorage.removeItem('oiiqt.state.v1'); sessionStorage.removeItem('oiiqt.passwords.v1');
      localStorage.removeItem('oiiqt.baseline.v1');
      location.reload();
    }, '确认清除');
  }
}
