// Service Worker: App offline verfügbar machen. Wetter-Anfragen gehen immer ins Netz.
const VERSION = 'v42';
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/store.js',
  'js/util.js',
  'js/engine.js',
  'js/weather.js',
  'js/special.js',
  'js/icons.js',
  'js/places.js',
  'js/gcal.js',
  'js/remote.js',
  'js/gplaces.js',
  'js/config.js',
  'js/photos.js',
  'js/generate.js',
  'js/events.js',
  'js/images.js',
  'js/area.js',
  'js/taste.js',
  'data/ideas.json',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Netz zuerst (damit Updates sofort ankommen), Cache als Fallback offline.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }) // beim Server nachfragen, ob es eine neue Version gibt
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))),
  );
});
