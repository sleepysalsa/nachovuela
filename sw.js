/* NachoVuela service worker — cache del shell + datos para uso offline */
const CACHE = 'nachovuela-v2';
const SHELL = [
  './', './index.html', './styles.css', './app.js',
  './manifest.webmanifest', './assets/logo-mark.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

/* Datos: network-first (para ver lo último); shell: cache-first */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const isData = url.pathname.includes('/data/') || url.pathname.endsWith('config.json');
  if (isData) {
    e.respondWith(
      fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return r;
      }).catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(()=>caches.match('./index.html')))
    );
  }
});
