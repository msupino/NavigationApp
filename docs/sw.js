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
  // Only cache 2xx responses (#84: never cache a 404/5xx as the offline
  // shell) and AWAIT the cache.put inside the respondWith promise so the
  // SW lifecycle can't terminate mid-write on slow devices.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(async resp => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            const c = await caches.open(CACHE);
            await c.put(e.request, copy);
          }
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
      // #144: only cache 2xx responses. cacheable() restricts to same-origin
      // and unpkg.com, both of which serve CORS, so the legitimate cases all
      // produce resp.ok. Caching opaque blindly was a cache-poisoning surface
      // if upstream ever started returning redirects.
      if (resp && resp.ok) {
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
