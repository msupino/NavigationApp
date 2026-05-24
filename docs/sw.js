/* NavAid service worker — installable PWA + offline app shell.
   Map tiles (cross-origin, large) are left to the network. */
const CACHE = 'navaid-v4';

function cacheable(url) {
  return url.origin === self.location.origin || url.host === 'unpkg.com';
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (!cacheable(url)) return;            // map tiles etc -> straight to network

  // HTML navigations: network-first so a new ?v= is picked up immediately.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(resp => {
          const copy = resp.clone();   // clone before the body is consumed
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return resp;
        })
        .catch(() => caches.match(e.request)));
    return;
  }

  // Versioned assets: cache-first. On a cache miss, prune sibling ?v= entries
  // for the same path so stale versions don't accumulate indefinitely.
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const resp = await fetch(e.request);
      if (resp && (resp.ok || resp.type === 'opaque')) {
        cache.put(e.request, resp.clone());
        if (url.search.includes('v=')) {
          const keys = await cache.keys();
          for (const k of keys) {
            const ku = new URL(k.url);
            if (ku.pathname === url.pathname && k.url !== e.request.url) {
              cache.delete(k);
            }
          }
        }
      }
      return resp;
    }));
});
