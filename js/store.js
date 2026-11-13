/* Local persistence (localStorage) + in-memory runtime state */

const KEY = 'oiiqt.state.v1';
const SESSION_KEY = 'oiiqt.passwords.v1';

export const DEFAULT_MODULES = {
  posterWall: true, liveTraffic: true, todayTransfer: false, globalAssets: true,
  serverStatus: true, storageAudit: false, recentFinished: true
};

const defaults = () => ({
  version: 1,
  servers: [],
  activeServerId: 'all',
  settings: {
    theme: 'auto',
    refreshInterval: 5,
    transport: 'auto',
    proxyBase: '',
    aggregate: true,
    savePassword: true,
    allowInsecureSSL: false,
    dashboardModules: { ...DEFAULT_MODULES },
    hideNodeNames: false,
    tmdbKey: '',
    trackerAliases: {},
    presetPaths: [],
    mpInstances: [],
    rssSources: [],
    rssRules: [],
    rssRefreshMinutes: 30,
    language: 'zh'
  }
});

function readSessionPasswords() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}'); } catch { return {}; }
}
function writeSessionPasswords(map) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

export const state = defaults();

/* Runtime-only state, never persisted */
export const runtime = {
  tasks: [],            // unified TorrentTask[]
  tasksByServer: {},    // serverId -> {tasks, error, updatedAt}
  stats: {},            // serverId -> stats snapshot
  connection: {},       // serverId -> 'online' | 'offline' | 'pending'
  lastRefresh: 0,
  selected: new Set(),
  search: '',
  statusFilter: 'all',
  categoryFilter: '',
  tagFilter: '',
  trackerFilter: '',
  sortKey: 'dateAdded',
  sortAsc: false,
  selectionMode: false,
  posters: {},          // name/hash -> poster url
  heroIndex: 0,
  page: 'dashboard',
  refreshing: false,
  mpCache: {},
  rssItems: {},
  baseline: {},         // today transfer baseline
};

export function load() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { raw = {}; }
  const d = defaults();
  Object.assign(state, d, raw);
  state.settings = Object.assign(d.settings, raw.settings || {});
  state.settings.dashboardModules = Object.assign({ ...DEFAULT_MODULES }, (raw.settings || {}).dashboardModules || {});
  if (!Array.isArray(state.servers)) state.servers = [];
  // merge session-only passwords (when "save password" is off)
  const sess = readSessionPasswords();
  state.servers.forEach(s => { if (!s.password && sess[s.id]) s.password = sess[s.id]; });
  try { runtime.baseline = JSON.parse(localStorage.getItem('oiiqt.baseline.v1') || '{}'); } catch { runtime.baseline = {}; }
  return state;
}

export function save() {
  const copy = JSON.parse(JSON.stringify(state));
  if (!copy.settings.savePassword) {
    const sess = readSessionPasswords();
    copy.servers.forEach(s => { if (s.password) sess[s.id] = s.password; delete s.password; });
    writeSessionPasswords(sess);
  }
  try { localStorage.setItem(KEY, JSON.stringify(copy)); } catch (e) { console.warn('save failed', e); }
}

export function saveBaseline() {
  try { localStorage.setItem('oiiqt.baseline.v1', JSON.stringify(runtime.baseline)); } catch { /* ignore */ }
}

export function addServer(s) {
  state.servers.push(s); save(); return s;
}
export function removeServer(id) {
  state.servers = state.servers.filter(s => s.id !== id);
  if (state.activeServerId === id) state.activeServerId = 'all';
  save();
}
export function getServer(id) { return state.servers.find(s => s.id === id); }
export function activeServers() {
  if (state.activeServerId === 'all') return state.servers;
  const s = getServer(state.activeServerId);
  return s ? [s] : state.servers;
}

export function exportConfig() {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), state }, null, 2);
}
export function importConfig(text) {
  const obj = JSON.parse(text);
  const incoming = obj.state || obj;
  if (!incoming || typeof incoming !== 'object') throw new Error('配置格式无效');
  if (incoming.servers) state.servers = incoming.servers;
  if (incoming.settings) state.settings = Object.assign(defaults().settings, incoming.settings);
  if (incoming.activeServerId) state.activeServerId = incoming.activeServerId;
  save();
}
