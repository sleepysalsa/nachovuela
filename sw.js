/* NachoVuela service worker — red primero con respaldo offline.
   Estrategia: TODO va a la red primero (así cada deploy se ve al instante)
   y se guarda copia en cache; si no hay conexión, se sirve la copia. */
const CACHE = 'nachovuela-v9';
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

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // externos: dejar pasar
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() =>
      caches.match(e.request).then(r => r || caches.match('./index.html'))
    )
  );
});
