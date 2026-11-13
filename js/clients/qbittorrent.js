/* qBittorrent WebUI API v2 client — ported from OiiQT/QBittorrentClient.swift */
import { request, resetJar } from '../transport.js';
import { normalizeServer, mapQBState, makeTask, splitTags, trackerHost, formPair, withRelogin } from './common.js';

export class QBittorrentClient {
  constructor(server) {
    this.server = server;
    const n = normalizeServer(server);
    this.base = n.base; this.apiBase = n.apiBase;
    this.loggedIn = false;
  }

  req(path, { method = 'GET', body = null, form = null, timeout = 25000, headers = {} } = {}) {
    return request({
      url: this.apiBase + path, method, body, form, timeout,
      jar: this.server.id, insecure: !!this.server.allowInsecureSSL,
      headers: {
        'Referer': this.base, 'Origin': this.base,
        'Accept': 'application/json, text/plain, */*', ...headers
      }
    });
  }

  async login() {
    const r = await this.req('/auth/login', {
      method: 'POST', timeout: 12000,
      form: formPair({ username: this.server.username || '', password: this.server.password || '' })
    });
    const t = String(r.text || '').trim();
    if (r.status !== 200 || /^Fails/i.test(t)) throw new Error('qBittorrent 登录失败：用户名或密码错误');
    this.loggedIn = true;
    return true;
  }
  async ensureLogin() { if (!this.loggedIn) await this.login(); }

  /** GET with automatic re-login when the SID cookie expired (HTTP 403). */
  async authReq(path, opts) {
    await this.ensureLogin();
    return withRelogin(
      () => this.req(path, opts),
      async () => { this.loggedIn = false; await resetJar(this.server.id); await this.login(); }
    );
  }

  async test() {
    await this.login();
    const r = await this.authReq('/app/version', { timeout: 8000 });
    if (r.status !== 200) throw new Error('无法读取 qBittorrent 版本信息');
    return { version: String(r.text || '').trim() || 'unknown' };
  }

  async fetchTorrents() {
    const r = await this.authReq('/torrents/info', { timeout: 45000 });
    if (r.status !== 200) throw new Error(`获取任务失败 (HTTP ${r.status})`);
    const list = r.json();
    if (!Array.isArray(list)) throw new Error('qBittorrent 返回了非预期的任务数据');
    return list.map(t => {
      const state = mapQBState(t.state);
      let tags = splitTags(t.tags);
      return makeTask(this.server, {
        hash: t.hash || '', name: t.name || '', progress: Number(t.progress) || 0,
        size: Number(t.size) || 0, dlSpeed: Number(t.dlspeed) || 0, upSpeed: Number(t.upspeed) || 0,
        eta: Number(t.eta) === 8640000 ? -1 : (Number(t.eta) || 0),
        status: state, error: state === 'error' ? String(t.state || 'error') : '',
        tracker: t.tracker || '', savePath: t.save_path || '', category: t.category || '', tags,
        downloaded: Number(t.downloaded) || 0, uploaded: Number(t.uploaded) || 0,
        addedOn: Number(t.added_on) || 0,
        completedOn: Number(t.completion_on) > 0 ? Number(t.completion_on) : (Number(t.seen_complete) || 0),
        seedingTime: Number(t.seeding_time) || 0, ratio: Number(t.ratio) || 0,
        numSeeds: Number(t.num_seeds) || 0, totalSeeds: Number(t.num_complete) || 0,
        numPeers: Number(t.num_leechs) || 0, totalPeers: Number(t.num_incomplete) || 0,
        isSequential: !!t.seq_dl, isFirstLastPiecePriority: !!t.f_l_piece_prio,
        rawState: t.state
      });
    });
  }

  async stats(tasks = []) {
    const sum = (k) => tasks.reduce((a, t) => a + (Number(t[k]) || 0), 0);
    const out = {
      dlSpeed: sum('dlSpeed'), upSpeed: sum('upSpeed'),
      downloading: tasks.filter(t => t.status === 'downloading').length,
      seeding: tasks.filter(t => t.status === 'seeding').length,
      totalSize: sum('size'), freeSpace: 0, alltimeDL: sum('downloaded'), alltimeUL: sum('uploaded'),
      savePath: '', ratio: tasks.length ? tasks.reduce((a, t) => a + (Number(t.ratio) || 0), 0) / tasks.length : 0,
      version: ''
    };
    const [ti, md, pref] = await Promise.allSettled([
      this.authReq('/transfer/info', { timeout: 12000 }),
      this.authReq('/sync/maindata?rid=0', { timeout: 12000 }),
      this.authReq('/app/preferences', { timeout: 12000 })
    ]);
    try {
      const j = ti.value.json();
      out.dlSpeed = Number(j.dl_info_speed) || out.dlSpeed;
      out.upSpeed = Number(j.up_info_speed) || out.upSpeed;
      out.freeSpace = Number(j.free_space_on_disk) || 0;
      out.alltimeDL = Number(j.alltime_dl) || out.alltimeDL;
      out.alltimeUL = Number(j.alltime_ul) || out.alltimeUL;
    } catch { /* optional */ }
    try {
      const ss = md.value.json().server_state || {};
      out.freeSpace = out.freeSpace || Number(ss.free_space_on_disk) || 0;
      out.alltimeDL = out.alltimeDL || Number(ss.alltime_dl) || 0;
      out.alltimeUL = out.alltimeUL || Number(ss.alltime_ul) || 0;
      out.savePath = ss.default_save_path || out.savePath;
      out.dlSpeed = out.dlSpeed || Number(ss.dl_info_speed) || 0;
      out.upSpeed = out.upSpeed || Number(ss.up_info_speed) || 0;
    } catch { /* optional */ }
    try { out.savePath = pref.value.json().save_path || out.savePath; } catch { /* optional */ }
    return out;
  }

  /** POST /api/v2/torrents/{endpoint} with `hashes=a|b|all` */
  async action(endpoint, hashes, extra = {}, hashKey = 'hashes') {
    const list = Array.isArray(hashes) ? hashes : [hashes];
    const val = (list.length === 1 && list[0] === 'all') ? 'all' : list.join('|').toLowerCase();
    const form = formPair({ [hashKey]: val, ...extra });
    const r = await this.authReq('/torrents/' + endpoint, { method: 'POST', form });
    if (r.status !== 200) throw new Error(`操作 ${endpoint} 失败 (HTTP ${r.status})`);
    if (/^Fails/i.test(String(r.text || '').trim())) throw new Error(`操作 ${endpoint} 被服务器拒绝`);
    return true;
  }

  pause(hashes) { return this.fallback(() => this.action('pause', hashes), () => this.action('stop', hashes)); }
  resume(hashes) { return this.fallback(() => this.action('resume', hashes), () => this.action('start', hashes)); }
  async fallback(a, b) { try { return await a(); } catch { return await b(); } }
  forceStart(hashes) { return this.action('setForceStart', hashes, { value: 'true' }); }
  recheck(hashes) { return this.action('recheck', hashes); }
  reannounce(hashes) { return this.action('reannounce', hashes); }
  remove(hashes, deleteFiles = false) { return this.action('delete', hashes, { deleteFiles: String(!!deleteFiles) }); }
  rename(hash, name) { return this.action('rename', [hash], { name }, 'hash'); }
  setLocation(hashes, location) { return this.action('setLocation', hashes, { location }); }
  setCategory(hashes, category) { return this.action('setCategory', hashes, { category }); }
  addTags(hashes, tags) { return this.action('addTags', hashes, { tags: (Array.isArray(tags) ? tags : [tags]).join(',') }); }
  removeTags(hashes, tags) { return this.action('removeTags', hashes, { tags: (Array.isArray(tags) ? tags : [tags]).join(',') }); }
  setDownloadLimit(hashes, bytes) { return this.action('setDownloadLimit', hashes, { limit: String(Math.max(0, Math.round(bytes))) }); }
  setUploadLimit(hashes, bytes) { return this.action('setUploadLimit', hashes, { limit: String(Math.max(0, Math.round(bytes))) }); }
  setShareLimits(hashes, ratioLimit, seedingTimeLimit) {
    return this.action('setShareLimits', hashes, {
      ratioLimit: String(ratioLimit), seedingTimeLimit: String(seedingTimeLimit)
    });
  }
  sequential(hashes) { return this.action('toggleSequentialDownload', hashes); }
  firstLastPrio(hashes) { return this.action('toggleFirstLastPiecePrio', hashes); }
  addTrackers(hash, urls) { return this.action('addTrackers', [hash], { urls: urls.join('\n') }); }
  removeTrackers(hash, urls) { return this.action('removeTrackers', [hash], { urls: urls.join('|') }, 'hash'); }

  async addTorrent({ urls = [], files = [], options = {} }) {
    await this.ensureLogin();
    const form = [
      { name: 'urls', value: (urls || []).join('\n') },
      { name: 'paused', value: String(!!options.isPaused) },
      { name: 'stopped', value: String(!!options.isPaused) },
      { name: 'skip_checking', value: String(!!options.skipHashCheck) },
      { name: 'sequentialDownload', value: String(!!options.isSequential) },
      { name: 'firstLastPiecePrio', value: String(!!options.isFirstLastPiecePriority) }
    ];
    if (options.savePath) form.push({ name: 'savepath', value: options.savePath });
    if (options.category) form.push({ name: 'category', value: options.category });
    if (options.tags?.length) form.push({ name: 'tags', value: options.tags.join(',') });
    (files || []).forEach(f => form.push({
      name: 'torrents', filename: f.name, contentType: 'application/x-bittorrent', base64: f.base64
    }));
    const r = await this.authReq('/torrents/add', { method: 'POST', form, timeout: 45000 });
    if (r.status !== 200 || /^Fails/i.test(String(r.text || '').trim())) throw new Error('添加任务失败，请检查链接或种子文件');
    return true;
  }

  async getFiles(hash) {
    const r = await this.authReq('/torrents/files?hash=' + encodeURIComponent(hash));
    return (r.json() || []).map((f, i) => ({
      index: i, name: f.name || '', size: Number(f.size) || 0,
      progress: Number(f.progress) || 0, priority: Number(f.priority) ?? 1
    }));
  }
  setFilePriority(hash, ids, priority) {
    return this.action('filePrio', [hash], { id: ids.join('|'), priority: String(priority) }, 'hash');
  }
  async getProperties(hash) {
    const r = await this.authReq('/torrents/properties?hash=' + encodeURIComponent(hash));
    const j = r.json() || {};
    return {
      dlLimit: Number(j.dl_limit) || 0, upLimit: Number(j.up_limit) || 0,
      totalSize: Number(j.total_size) || 0, piecesNum: Number(j.pieces_num) || 0,
      pieceSize: Number(j.piece_size) || 0, shareRatio: Number(j.share_ratio) || 0,
      additionDate: Number(j.addition_date) || 0, completionDate: Number(j.completion_date) || 0,
      createdBy: j.created_by || '', comment: j.comment || '', savePath: j.save_path || ''
    };
  }
  async getTrackers(hash) {
    const r = await this.authReq('/torrents/trackers?hash=' + encodeURIComponent(hash));
    return (r.json() || []).map(t => ({
      url: t.url || '', status: Number(t.status) || 0,
      numPeers: Number(t.num_peers) || 0, numSeeds: Number(t.num_seeds) || 0,
      numLeeches: Number(t.num_leeches) || 0, msg: t.msg || ''
    }));
  }
  async getCategories() {
    try { return (await this.authReq('/torrents/categories')).json() || {}; } catch { return {}; }
  }
  async getTags() {
    try {
      const r = await this.authReq('/torrents/tags');
      const j = r.json();
      return Array.isArray(j) ? j : splitTags(String(r.text || '').replace(/[\[\]"]/g, ''));
    } catch { return []; }
  }
  createCategory(name, savePath) { return this.authReq('/torrents/createCategory', { method: 'POST', form: formPair({ category: name, savePath }) }); }
  removeCategories(names) { return this.authReq('/torrents/removeCategories', { method: 'POST', form: formPair({ categories: names.join('\n') }) }); }
  createTags(tags) { return this.authReq('/torrents/createTags', { method: 'POST', form: formPair({ tags: tags.join(',') }) }); }
  deleteTags(tags) { return this.authReq('/torrents/deleteTags', { method: 'POST', form: formPair({ tags: tags.join(',') }) }); }

  async globalLimits() {
    const [p, dl, ul, mode] = await Promise.allSettled([
      this.authReq('/app/preferences'), this.authReq('/transfer/downloadLimit'),
      this.authReq('/transfer/uploadLimit'), this.authReq('/transfer/speedLimitsMode')
    ]);
    let out = { dlLimit: 0, upLimit: 0, altEnabled: false, scheduler: false, mode: 0 };
    try { const j = p.value.json(); out.dlLimit = Number(j.dl_limit) || 0; out.upLimit = Number(j.up_limit) || 0; out.scheduler = !!j.scheduler_enabled; } catch {}
    try { out.dlLimit = Number(dl.value.text) || out.dlLimit; } catch {}
    try { out.upLimit = Number(ul.value.text) || out.upLimit; } catch {}
    try { out.mode = Number(mode.value.text) || 0; } catch {}
    return out;
  }
  setGlobalDownloadLimit(bytes) { return this.authReq('/transfer/setDownloadLimit', { method: 'POST', form: formPair({ limit: String(Math.round(bytes)) }) }); }
  setGlobalUploadLimit(bytes) { return this.authReq('/transfer/setUploadLimit', { method: 'POST', form: formPair({ limit: String(Math.round(bytes)) }) }); }
  toggleAltLimits() { return this.authReq('/transfer/toggleSpeedLimitsMode', { method: 'POST' }); }
  async appPreferences() { return (await this.authReq('/app/preferences')).json(); }
  setPreferences(json) { return this.authReq('/app/setPreferences', { method: 'POST', form: formPair({ json: JSON.stringify(json) }) }); }
}
