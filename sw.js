/*
 * Messenger Wrapped — service worker.
 * Trzyma kopię plików strony, żeby działała po odświeżeniu w trybie samolotowym.
 * Najpierw sieć (zawsze najnowsza wersja), w razie braku sieci kopia.
 * Nie dotyka zapytań "__ping" (sprawdzanie trybu samolotowego).
 */
const CACHE = 'mw-v4';
const CORE = [
  './',
  'index.html',
  'app.html',
  'assets/js/teaser.js?v=4',
  'assets/css/fonts.css?v=4',
  'assets/css/stories.css?v=4',
  'assets/css/app.css?v=4',
  'assets/js/stories.js?v=4',
  'assets/js/exporter.js?v=4',
  'assets/js/demo.js?v=4',
  'assets/js/app.js?v=4',
  'assets/js/engine.js?v=4',
  'assets/fonts/anybody-latin.woff2',
  'assets/fonts/anybody-latin-ext.woff2',
  'assets/fonts/figtree-latin.woff2',
  'assets/fonts/figtree-latin-ext.woff2',
];

self.addEventListener('install', (e) => {
  // Każdy plik osobno: brak jednego (np. po zmianie nazwy strony) nie psuje instalacji
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.endsWith('/__ping')) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined))),
  );
});
