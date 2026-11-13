#!/usr/bin/env node
/*
 * One-shot GitHub publisher for OiiQT-Android.
 *
 * Why REST instead of `git push`: some networks only expose api.github.com.
 * This script uploads files through the Git Data API, starts the APK workflow,
 * waits for it and (best effort) downloads the APK to ./builds/.
 *
 *   export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
 *   node push-to-github.js                          # public repo "OiiQT-Android"
 *   node push-to-github.js myname/myrepo --private
 *   node push-to-github.js --pages                  # also publish the PWA online
 *   node push-to-github.js --dry-run                # list files, touch nothing
 *   node push-to-github.js --no-build               # push only, skip cloud build
 *
 * GitHub Free cannot serve Pages from a private repository. With --private
 * --pages we therefore create a second, PUBLIC repo "<name>-web" containing
 * only static front-end assets; the source repo stays private.
 *
 * The token is read from the environment only. It is never written to disk
 * or printed. A classic PAT with `repo` + `workflow` scope is recommended.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;
// GITHUB_API is overridable for GitHub Enterprise / local testing.
const API = (process.env.GITHUB_API || 'https://api.github.com').replace(/\/+$/, '');
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const NO_BUILD = args.includes('--no-build');
const PRIVATE = args.includes('--private');
const PAGES = args.includes('--pages');
const positional = args.filter(a => !a.startsWith('--'));
const target = positional[0] || '';

const SKIP_DIR = new Set(['.git', 'node_modules', 'dist', 'android', '.check', '.check2', 'builds']);
const SKIP_FILE = /^(.*\.log|oiiqt-config-.*\.json|package-lock\.json)$/i;
const SITE_FILE = /^(index\.html|manifest\.webmanifest|sw\.js)$|^(css|js|icons)\//;

function collect(dir, rel = '', out = []) {
  for (const name of fs.readdirSync(dir).sort()) {
    if (rel === '' && SKIP_DIR.has(name)) continue;
    const abs = path.join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    const st = fs.statSync(abs);
    if (st.isDirectory()) collect(abs, r, out);
    else if (!SKIP_FILE.test(name)) out.push({ path: r, abs, size: st.size });
  }
  return out;
}

async function api(method, endpoint, body, { raw = false } = {}) {
  const res = await fetch(API + endpoint, {
    method,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Accept': raw ? 'application/octet-stream' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'OiiQT-Android-Publisher',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'follow'
  });
  if (raw) {
    if (!res.ok) throw new Error(`${method} ${endpoint} -> HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data && data.message ? data.message : String(data).slice(0, 200);
    const err = new Error(`${method} ${endpoint} -> HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ensureRepo(owner, name, isPrivate, description) {
  try {
    const repo = await api('POST', '/user/repos', {
      name, description, private: isPrivate,
      has_issues: false, has_projects: false, has_wiki: false, auto_init: false
    });
    console.log(`仓库已创建: ${repo.html_url}`);
    return repo;
  } catch (e) {
    if (e.status !== 422) throw e;
    const repo = await api('GET', `/repos/${owner}/${name}`);
    console.log(`复用已有仓库: ${repo.html_url}`);
    return repo;
  }
}

/** Push a complete file list to a branch via the Git Data API. */
async function pushFiles(R, files, branch, message) {
  let baseSha = null, baseTree = null;
  try {
    const ref = await api('GET', `${R}/git/ref/heads/${branch}`);
    baseSha = ref.object.sha;
    const c = await api('GET', `${R}/git/commits/${baseSha}`);
    baseTree = c.tree.sha;
    console.log(`更新分支 ${branch} (基于 ${String(baseSha).slice(0, 7)})`);
  } catch (e) {
    if (e.status !== 404 && e.status !== 409) throw e;
    // GitHub rejects Git Data API blob creation with 409 "Git Repository is
    // empty" until the repo has its first commit. Seed it via Contents API.
    console.log('空仓库：先用 README 建立初始提交');
    const seed = files.find(f => f.path === 'README.md') || files[0];
    const seedPath = seed.path.split('/').map(encodeURIComponent).join('/');
    await api('PUT', `${R}/contents/${seedPath}`, {
      message: 'Initialize repository',
      content: fs.readFileSync(seed.abs).toString('base64')
    });
    for (let i = 0; i < 6 && !baseSha; i++) {
      try {
        const info = await api('GET', R);
        branch = info.default_branch || branch;
        const ref = await api('GET', `${R}/git/ref/heads/${branch}`);
        baseSha = ref.object.sha;
        const c = await api('GET', `${R}/git/commits/${baseSha}`);
        baseTree = c.tree.sha;
      } catch { await sleep(1500); }
    }
    if (!baseSha) throw new Error('空仓库初始化失败，请稍后重试');
    console.log(`初始提交 ${String(baseSha).slice(0, 7)}，继续推送`);
  }

  console.log(`上传 ${files.length} 个文件...`);
  const tree = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const blob = await api('POST', `${R}/git/blobs`, {
      content: fs.readFileSync(f.abs).toString('base64'), encoding: 'base64'
    });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    if ((i + 1) % 10 === 0 || i === files.length - 1) process.stdout.write(`  ${i + 1}/${files.length}\r`);
  }
  process.stdout.write('\n');

  const treeObj = await api('POST', `${R}/git/trees`,
    baseTree ? { base_tree: baseTree, tree } : { tree });
  const commit = await api('POST', `${R}/git/commits`, {
    message, tree: treeObj.sha, parents: baseSha ? [baseSha] : []
  });
  if (baseSha) await api('PATCH', `${R}/git/refs/heads/${branch}`, { sha: commit.sha });
  else {
    try { await api('POST', `${R}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha }); }
    catch { await api('PATCH', `${R}/git/refs/heads/${branch}`, { sha: commit.sha }); }
  }
  return commit.sha;
}

/** Public site repo for private source repos (GitHub Free Pages limitation). */
async function publishSeparateSite(owner, siteName, files) {
  const siteFiles = files.filter(f => SITE_FILE.test(f.path));
  console.log(`\n在线版：创建公开站点仓库 ${owner}/${siteName}（仅 ${siteFiles.length} 个前端静态文件）`);
  await ensureRepo(owner, siteName, false,
    'OiiQT for Android — public PWA static site (no credentials, no server code)');
  const SR = `/repos/${owner}/${siteName}`;
  await pushFiles(SR, siteFiles, 'main', 'Publish PWA static site');
  try {
    await api('POST', `${SR}/pages`, { build_type: 'legacy', source: { branch: 'main', path: '/' } });
  } catch {
    try { await api('PUT', `${SR}/pages`, { build_type: 'legacy', source: { branch: 'main', path: '/' } }); }
    catch (e) { console.log(`  Pages 配置提示: ${e.message}`); }
  }
  const url = `https://${owner.toLowerCase()}.github.io/${siteName}/`;
  console.log(`在线版地址: ${url}  （首次生效约需 1~2 分钟）`);
  return url;
}

/* Minimal ZIP reader (artifact zips are single-file, stored or deflated). */
function unzipFirst(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const lnLen = buf.readUInt16LE(localOff + 26);
    const lxLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lnLen + lxLen;
    const data = buf.subarray(start, start + compSize);
    return { name, data: method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data) };
  }
  throw new Error('ZIP 内没有文件');
}

async function main() {
  const files = collect(ROOT);
  const total = files.reduce((s, f) => s + f.size, 0);
  console.log(`待上传 ${files.length} 个文件，共 ${(total / 1024).toFixed(1)} KB`);
  if (DRY) {
    files.forEach(f => console.log('  ' + f.path));
    console.log('\n(--dry-run：未执行任何网络操作)');
    return;
  }
  if (!TOKEN) {
    console.error('\n缺少 GITHUB_TOKEN 环境变量。');
    console.error('  PowerShell: $env:GITHUB_TOKEN="ghp_xxx"; node push-to-github.js');
    console.error('  Bash:       GITHUB_TOKEN=ghp_xxx node push-to-github.js');
    process.exit(1);
  }

  const me = await api('GET', '/user');
  const owner = target.includes('/') ? target.split('/')[0] : me.login;
  const name = target.includes('/') ? target.split('/').slice(1).join('/') : 'OiiQT-Android';
  console.log(`GitHub 账号: ${me.login}   目标仓库: ${owner}/${name} (${PRIVATE ? '私有' : '公开'})`);

  const repo = await ensureRepo(owner, name, PRIVATE,
    'OiiQT for Android — qBittorrent / Transmission / MoviePilot client (PWA + Capacitor APK)');
  const R = `/repos/${owner}/${name}`;
  const branch = repo.default_branch || 'main';
  const sha = await pushFiles(R, files, branch, 'OiiQT for Android: PWA + Capacitor APK build');
  console.log(`已推送提交 ${String(sha).slice(0, 7)} → ${branch}`);
  console.log(`仓库地址: https://github.com/${owner}/${name}`);

  if (PAGES) {
    if (PRIVATE) {
      await publishSeparateSite(owner, name.replace(/-web$/, '') + '-web', files)
        .catch(e => console.log(`在线版部署失败: ${e.message}`));
    } else {
      try { await api('POST', `${R}/pages`, { build_type: 'workflow' }); }
      catch {
        try { await api('PUT', `${R}/pages`, { build_type: 'workflow' }); } catch { /* configured */ }
      }
      let pagesStarted = false;
      for (let i = 0; i < 8 && !pagesStarted; i++) {
        try {
          await api('POST', `${R}/actions/workflows/deploy-pages.yml/dispatches`, { ref: branch });
          pagesStarted = true;
          console.log(`在线版部署已触发: https://${owner.toLowerCase()}.github.io/${name}/`);
        } catch (e) {
          if (e.status !== 404) break;
          await sleep(3000);
        }
      }
      if (!pagesStarted) console.log('Pages 部署需到 Actions 页面手动运行 "Deploy PWA to Pages"。');
    }
  }

  if (NO_BUILD) return;

  // Workflows need a moment to register on a freshly created repo.
  let dispatched = false;
  for (let i = 0; i < 8 && !dispatched; i++) {
    try {
      await api('POST', `${R}/actions/workflows/build-apk.yml/dispatches`,
        { ref: branch, inputs: { release: true } });
      dispatched = true;
    } catch (e) {
      if (e.status === 422) {
        // Some GitHub versions require string values for boolean inputs.
        try {
          await api('POST', `${R}/actions/workflows/build-apk.yml/dispatches`,
            { ref: branch, inputs: { release: 'true' } });
          dispatched = true; continue;
        } catch { /* fall through */ }
      }
      if (e.status !== 404) break;
      await sleep(3000);
    }
  }
  if (!dispatched) {
    console.log('\n工作流尚未就绪，请到 Actions 页面手动点击 "Run workflow"。');
    return;
  }
  console.log('\n云编译已触发，等待构建（通常 5~12 分钟）...');

  let runId = null;
  for (let i = 0; i < 40 && !runId; i++) {
    const runs = await api('GET', `${R}/actions/runs?event=workflow_dispatch&per_page=5`);
    const hit = (runs.workflow_runs || []).find(r => /Build Android APK/.test(r.name));
    if (hit) runId = hit.id;
    else await sleep(3000);
  }
  if (!runId) { console.log('未查询到构建记录，请到 Actions 页面查看。'); return; }

  let conclusion = null;
  for (let i = 0; i < 120; i++) {
    const run = await api('GET', `${R}/actions/runs/${runId}`);
    if (run.status === 'completed') { conclusion = run.conclusion; break; }
    if (i % 6 === 0) process.stdout.write(`  状态: ${run.status} ...\r`);
    await sleep(10000);
  }
  process.stdout.write('\n');
  console.log(`构建结果: ${conclusion || '超时（仍在运行）'}`);
  if (conclusion !== 'success') {
    console.log(`日志: https://github.com/${owner}/${name}/actions/runs/${runId}`);
    return;
  }

  try {
    const arts = await api('GET', `${R}/actions/runs/${runId}/artifacts`);
    const art = (arts.artifacts || []).find(a => /apk/i.test(a.name));
    if (!art) throw new Error('没有找到 APK artifact');
    const zip = await api('GET', `${R}/actions/artifacts/${art.id}/zip`, undefined, { raw: true });
    const { data } = unzipFirst(zip);
    const dir = path.join(ROOT, 'builds');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, 'OiiQT.apk');
    fs.writeFileSync(out, data);
    console.log(`\nAPK 已下载: ${out} (${(data.length / 1024 / 1024).toFixed(1)} MB)`);
  } catch (e) {
    console.log(`\nAPK 自动下载失败（${e.message}）。`);
    console.log(`请到 https://github.com/${owner}/${name}/actions/runs/${runId} 下载 OiiQT-debug-apk。`);
  }
}

main().catch(e => { console.error('\n失败: ' + e.message); process.exit(1); });
