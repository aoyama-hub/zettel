// Network-first for the app's own files: always revalidate so a deploy never mixes old and new modules,
// and fall back to the last good copy when offline. GitHub API calls are not intercepted.
const CACHE = 'zettel-app';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' });
        if (response.ok) cache.put(request.url.split('?')[0], response.clone());
        return response;
      } catch (err) {
        const cached = await cache.match(request.url.split('?')[0]);
        if (cached) return cached;
        throw err;
      }
    })(),
  );
});
