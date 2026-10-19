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
      const load = () => fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' });
      try {
        // One retry: a single dropped connection on a first load would otherwise fail a module
        // outright, and there is no cached copy to fall back to yet.
        const response = await load().catch(() => load());
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
