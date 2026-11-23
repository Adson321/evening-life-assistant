const cacheName = 'evening-life-assistant-' + self.registration.scope + '-v3';
const assets = ['./', './index.html', './sync.js', './manifest.webmanifest', './icon.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !assets.some(path => new URL(path, self.registration.scope).href === event.request.url)) return;
  event.respondWith(fetch(event.request).catch(() => caches.open(cacheName).then(cache => cache.match(event.request))));
});
