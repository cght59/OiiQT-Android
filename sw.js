/* OiiQT service worker: app shell offline, proxy requests always hit network. */
const CACHE = 'oiiqt-shell-v1';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './icons/icon-192.png', './icons/icon-512.png',
  './js/app.js', './js/core.js', './js/store.js', './js/transport.js',
  './js/util.js', './js/posters.js',
  './js/clients/index.js', './js/clients/common.js', './js/clients/qbittorrent.js',
  './js/clients/transmission.js', './js/clients/moviepilot.js',
  './js/views/dashboard.js', './js/views/transfers.js', './js/views/automation.js',
  './js/views/moviepilot.js', './js/views/settings.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;           // posters / TMDB: network directly
  if (u.pathname.endsWith('/proxy') || u.pathname === '/health') return; // never cache API traffic
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
