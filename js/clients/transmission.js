/* Transmission RPC client — ported from OiiQT/TransmissionClient.swift */
import { request } from '../transport.js';
import { normalizeServer, basicAuth, mapTRStatus, makeTask, splitTags } from './common.js';

const TORRENT_FIELDS = [
  'id', 'hashString', 'name', 'totalSize', 'rateDownload', 'rateUpload', 'status',
  'error', 'errorString', 'downloadDir', 'percentDone', 'doneDate', 'eta',
  'downloadedEver', 'uploadedEver', 'uploadRatio', 'peersConnected', 'addedDate',
  'secondsSeeding', 'tracker', 'trackers', 'labels', 'downloadLimit', 'downloadLimited',
  'uploadLimit', 'uploadLimited', 'priority', 'isFinished'
];

export class TransmissionClient {
  constructor(server) {
    this.server = server;
    this.rpcUrl = normalizeServer(server).rpcUrl;
    this.sessionId = null;
  }

  async rpc(method, args = {}, { retry = true, timeout = 25000 } = {}) {
    const headers = {
      'Authorization': basicAuth(this.server.username, this.server.password),
      'Content-Type': 'application/json', 'Accept': 'application/json'
    };
    if (this.sessionId) headers['X-Transmission-Session-Id'] = this.sessionId;
    const body = JSON.stringify({ method, arguments: args });
    const doRequest = () => request({
      url: this.rpcUrl, method: 'POST', headers, body, timeout,
      jar: this.server.id, insecure: !!this.server.allowInsecureSSL
    });
    let r = await doRequest();
    if (r.status === 409 && retry) {
      const sid = r.header('X-Transmission-Session-Id');
      if (sid) {
        this.sessionId = sid;
        headers['X-Transmission-Session-Id'] = sid;
        r = await doRequest();
      }
    }
    if (r.status === 401) throw new Error('Transmission 认证失败：用户名或密码错误');
    if (r.status !== 200) throw new Error(`Transmission RPC 失败 (HTTP ${r.status})`);
    let j; try { j = r.json(); } catch { throw new Error('Transmission 返回内容无效'); }
    if (j.result && j.result !== 'success') throw new Error('Transmission RPC 错误: ' + j.result);
    return j.arguments || {};
  }

  async test() {
    if (!this.sessionId) {
      try {
        const headers = { 'Authorization': basicAuth(this.server.username, this.server.password), 'Content-Type': 'application/json' };
        const r = await request({ url: this.rpcUrl, method: 'POST', headers, body: JSON.stringify({ method: 'session-get', arguments: {} }), jar: this.server.id, insecure: !!this.server.allowInsecureSSL, timeout: 8000 });
        const sid = r.header('X-Transmission-Session-Id');
        if (sid) this.sessionId = sid;
      } catch { /* normal RPC path will retry */ }
    }
    const a = await this.rpc('session-get');
    return { version: a.version || 'unknown' };
  }

  async fetchTorrents() {
    const a = await this.rpc('torrent-get', { fields: TORRENT_FIELDS }, { timeout: 45000 });
    return (a.torrents || []).map(t => {
      let tracker = t.tracker || (Array.isArray(t.trackers) && t.trackers[0]?.announce) || '';
      if (tracker && !tracker.includes('://')) tracker = 'http://' + tracker;
      const progress = Math.round((Number(t.percentDone) || 0) * 1000) / 1000;
      return makeTask(this.server, {
        hash: t.hashString || String(t.id || ''), name: t.name || '',
        progress, size: Number(t.totalSize) || 0,
        dlSpeed: Math.floor((Number(t.rateDownload) || 0) / 1024) * 1024,
        upSpeed: Math.floor((Number(t.rateUpload) || 0) / 1024) * 1024,
        eta: Number(t.eta) || 0,
        status: mapTRStatus(t.status, t.error, t.errorString),
        error: t.errorString || '', tracker, savePath: t.downloadDir || '',
        category: '', tags: splitTags(t.labels),
        downloaded: Number(t.downloadedEver) || 0, uploaded: Number(t.uploadedEver) || 0,
        addedOn: Number(t.addedDate) || 0, completedOn: Number(t.doneDate) > 0 ? Number(t.doneDate) : 0,
        seedingTime: Number(t.secondsSeeding) || 0, ratio: Number(t.uploadRatio) || 0,
        numSeeds: 0, totalSeeds: 0, numPeers: Number(t.peersConnected) || 0, totalPeers: 0,
        rawStatus: t.status
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
    const [st, ss] = await Promise.allSettled([this.rpc('session-stats'), this.rpc('session-get')]);
    try {
      const c = st.value['cumulative-stats'] || {};
      out.alltimeDL = Math.max(out.alltimeDL, Number(c.downloadedBytes) || 0);
      out.alltimeUL = Math.max(out.alltimeUL, Number(c.uploadedBytes) || 0);
    } catch {}
    try {
      out.savePath = ss.value['download-dir'] || '';
      out.version = ss.value.version || '';
    } catch {}
    try {
      if (out.savePath) {
        const fs = await this.rpc('free-space', { path: out.savePath }, { timeout: 10000 });
        out.freeSpace = Number(fs['size-bytes']) || 0;
      }
    } catch {}
    return out;
  }

  ids(hashes) {
    if (Array.isArray(hashes) && hashes.length === 1 && hashes[0] === 'all') return undefined;
    return Array.isArray(hashes) ? hashes : [hashes];
  }
  async act(method, hashes, extra = {}) {
    const args = { ...extra };
    const ids = this.ids(hashes);
    if (ids !== undefined) args.ids = ids;
    return this.rpc(method, args);
  }
  pause(hashes) { return this.act('torrent-stop', hashes); }
  resume(hashes) { return this.act('torrent-start', hashes); }
  forceStart(hashes) { return this.act('torrent-start-now', hashes); }
  recheck(hashes) { return this.act('torrent-verify', hashes); }
  reannounce(hashes) { return this.act('torrent-reannounce', hashes); }
  remove(hashes, deleteFiles = false) { return this.act('torrent-remove', hashes, { 'delete-local-data': !!deleteFiles }); }
  setLocation(hashes, location) { return this.act('torrent-set-location', hashes, { location, move: true }); }
  async rename(hash, name) {
    const a = await this.rpc('torrent-get', { ids: [hash], fields: ['name'] });
    const old = a.torrents?.[0]?.name;
    if (!old) throw new Error('找不到该任务');
    return this.act('torrent-rename-path', [hash], { path: old, name });
  }
  setCategory() { throw new Error('Transmission 不支持分类'); }
  addTags(hashes, tags) { return this.act('torrent-set', hashes, { labels: tags }); }
  removeTags(hashes, tags) { return this.act('torrent-set', hashes, { labels: tags }); }
  setDownloadLimit(hashes, kbps) {
    return this.act('torrent-set', hashes, { downloadLimited: kbps > 0, downloadLimit: Math.max(0, Math.round(kbps)) });
  }
  setUploadLimit(hashes, kbps) {
    return this.act('torrent-set', hashes, { uploadLimited: kbps > 0, uploadLimit: Math.max(0, Math.round(kbps)) });
  }
  setShareLimits(hashes, ratioLimit, seedingTimeLimit) {
    return this.act('torrent-set', hashes, {
      'seedRatioLimit': Number(ratioLimit) || 0,
      'seedIdleLimit': Number(seedingTimeLimit) || 0,
      'seedRatioMode': Number(ratioLimit) > 0 ? 1 : 0,
      'seedIdleMode': Number(seedingTimeLimit) > 0 ? 1 : 0
    });
  }
  sequential() { throw new Error('Transmission 不支持顺序下载'); }
  firstLastPrio() { throw new Error('Transmission 不支持首尾优先'); }
  addTrackers(hash, urls) { return this.act('torrent-set', [hash], { trackerAdd: urls }); }
  async removeTrackers(hash, urls) {
    const a = await this.rpc('torrent-get', { ids: [hash], fields: ['trackers'] });
    const all = a.torrents?.[0]?.trackers || [];
    const ids = all.filter(x => urls.includes(x.announce)).map(x => x.id);
    return this.act('torrent-set', [hash], { trackerRemove: ids });
  }

  async addTorrent({ urls = [], files = [], options = {} }) {
    let ok = 0;
    for (const u of urls) {
      const args = { filename: u, paused: !!options.isPaused };
      if (options.savePath) args['download-dir'] = options.savePath;
      if (options.tags?.length) args.labels = options.tags;
      try { await this.rpc('torrent-add', args, { timeout: 30000 }); ok++; } catch (e) { if (!urls.length) throw e; }
    }
    for (const f of files) {
      const args = { metainfo: f.base64, paused: !!options.isPaused };
      if (options.savePath) args['download-dir'] = options.savePath;
      if (options.tags?.length) args.labels = options.tags;
      try { await this.rpc('torrent-add', args, { timeout: 30000 }); ok++; } catch (e) { if (!urls.length && files.length === 1) throw e; }
    }
    if (!ok && (urls.length || files.length)) throw new Error('添加任务失败');
    return true;
  }

  async getFiles(hash) {
    const a = await this.rpc('torrent-get', { ids: [hash], fields: ['files', 'fileStats'] });
    const t = (a.torrents || [])[0] || {};
    return (t.files || []).map((f, i) => {
      const st = (t.fileStats || [])[i] || {};
      return {
        index: i, name: f.name || '', size: Number(f.length) || 0,
        progress: f.length ? (Number(f.bytesCompleted) || 0) / f.length : 0,
        priority: st.wanted === false ? 0 : st.priority < 0 ? 1 : st.priority === 1 ? 6 : 1,
        wanted: st.wanted !== false
      };
    });
  }
  setFilePriority(hash, ids, priority) {
    const args = { ids: [hash] };
    if (priority === 0) args['files-unwanted'] = ids;
    else {
      args['files-wanted'] = ids;
      if (priority >= 6) args['priority-high'] = ids; else args['priority-normal'] = ids;
    }
    return this.rpc('torrent-set', args);
  }
  async getProperties(hash) {
    const a = await this.rpc('torrent-get', {
      ids: [hash], fields: ['downloadLimit', 'downloadLimited', 'uploadLimit', 'uploadLimited', 'totalSize', 'comment', 'dateCreated', 'creator']
    });
    const t = (a.torrents || [])[0] || {};
    return {
      dlLimit: t.downloadLimited ? (Number(t.downloadLimit) || 0) * 1024 : 0,
      upLimit: t.uploadLimited ? (Number(t.uploadLimit) || 0) * 1024 : 0,
      totalSize: Number(t.totalSize) || 0, createdBy: t.creator || '', comment: t.comment || ''
    };
  }
  async getTrackers(hash) {
    const a = await this.rpc('torrent-get', { ids: [hash], fields: ['trackerStats', 'trackers'] });
    const t = (a.torrents || [])[0] || {};
    return (t.trackerStats || []).map(x => ({
      url: x.announce || x.host || '', status: x.lastAnnounceSucceeded ? 2 : 4,
      numPeers: Number(x.leecherCount) || 0, numSeeds: Number(x.seederCount) || 0,
      numLeeches: 0, msg: x.lastAnnounceResult || ''
    }));
  }
  async getCategories() { return {}; }
  async getTags() {
    try { const a = await this.rpc('session-get'); return splitTags(a.labels); } catch { return []; }
  }
  createTags(tags) { return this.rpc('session-set', { labels: tags }); }
  deleteTags(tags) { return this.rpc('session-set', { labels: tags }); }

  async globalLimits() {
    const a = await this.rpc('session-get', {
      fields: ['speed-limit-down', 'speed-limit-up', 'speed-limit-down-enabled', 'speed-limit-up-enabled', 'alt-speed-enabled', 'alt-speed-down', 'alt-speed-up', 'alt-speed-time-enabled']
    });
    return {
      dlLimit: (Number(a['speed-limit-down']) || 0) * 1024,
      upLimit: (Number(a['speed-limit-up']) || 0) * 1024,
      altEnabled: !!a['alt-speed-enabled'], scheduler: !!a['alt-speed-time-enabled'], mode: 0,
      raw: a
    };
  }
  setGlobalDownloadLimit(bytes) {
    const kb = Math.round(bytes / 1024);
    return this.rpc('session-set', { 'speed-limit-down': kb, 'speed-limit-down-enabled': kb > 0 });
  }
  setGlobalUploadLimit(bytes) {
    const kb = Math.round(bytes / 1024);
    return this.rpc('session-set', { 'speed-limit-up': kb, 'speed-limit-up-enabled': kb > 0 });
  }
  toggleAltLimits() { return this.rpc('session-set', { 'alt-speed-enabled': true }); }
}
