const CACHE = 'moneyos-offline-v3';
const FILES = ['./', './index.html', './styles.css', './app.js', './icon.svg', './manifest.webmanifest'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name.startsWith('moneyos-offline-') && name !== CACHE).map(name => caches.delete(name)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const path = url.pathname.split('/').pop();
  if (!(event.request.mode === 'navigate' || ['index.html','styles.css','app.js','icon.svg','manifest.webmanifest'].includes(path))) return;
  event.respondWith(fetch(event.request).then(response => {
    // Never cache authentication redirects or login pages served by a host.
    if (response.ok && !response.redirected && new URL(response.url).origin === url.origin) {
      const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy));
    }
    return response;
  }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
});
