const CACHE = 'krkgps-v8';
const STATIC = ['/', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Don't cache API calls
  if (url.pathname.startsWith('/api/')) return;
  // Cache static data files
  if (url.pathname.startsWith('/data/')) {
    e.respondWith(caches.open(CACHE).then(c =>
      c.match(e.request).then(r => r || fetch(e.request).then(res => { c.put(e.request, res.clone()); return res; }))
    ));
    return;
  }
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
