/* NavAid service worker — installable PWA + offline app shell.
   Map tiles (cross-origin or local MBTiles-backed, large) are left to the network. */
const CACHE = 'navaid-v6';
// Offline chart packs (offline-tiles.js): a dedicated bucket so the activate
// cleanup never wipes a 100+ MB user download on a service-worker upgrade.
const TILE_CACHE = 'navaid-tiles-v1';
const TILE_HOST = 'flight-maps.com';
// Tiles are the hottest request path (pans fetch dozens in a burst), so the
// SW only proxies them when a pack actually exists — otherwise the fetch
// handler returns without respondWith and the browser's native network path
// handles the tile with zero SW overhead (issue-388 magnifier perf).
let tilePackReady = false;
function refreshTilePackFlag() {
  return caches.has(TILE_CACHE).then(h => { tilePackReady = h; }, () => {});
}
refreshTilePackFlag();
self.addEventListener('message', e => {
  // Only accept the refresh ping from our own clients (CodeQL js/missing-origin-check;
  // some browsers report an empty origin for same-origin SW clients).
  if (e.origin && e.origin !== self.location.origin) return;
  if (e.data && e.data.type === 'tile-pack-changed') refreshTilePackFlag();
});

function cacheable(url) {
  // Local MBTiles dev tiles (?localTiles=1) are same-origin but must not be
  // cached as app-shell assets — leave them to the network like remote tiles.
  if (/\/tiles\/(?:cvfr|nav|la|il-hel)\//.test(url.pathname)) return false;
  // Same-origin app assets + the two pinned CDN libs the app can't run without.
  // leaflet-velocity ships from jsdelivr; without it the wind layer 404s offline.
  return url.origin === self.location.origin ||
    url.host === 'unpkg.com' || url.host === 'cdn.jsdelivr.net';
}

function scopeRootUrl() {
  return new URL('./', (self.registration && self.registration.scope) || self.location.href);
}

async function cachedAppShell(request) {
  const cache = await caches.open(CACHE);
  const exact = await cache.match(request);
  if (exact) return exact;

  const root = scopeRootUrl();
  const scopedRoot = await cache.match(root.href, { ignoreSearch: true });
  if (scopedRoot) return scopedRoot;

  const scopedIndex = await cache.match(new URL('index.html', root).href, { ignoreSearch: true });
  if (scopedIndex) return scopedIndex;

  const keys = await cache.keys();
  for (const key of keys) {
    const u = new URL(key.url);
    const acceptsHtml = key.mode === 'navigate' ||
      ((key.headers.get('accept') || '').indexOf('text/html') >= 0);
    if (acceptsHtml && u.origin === root.origin && u.pathname.indexOf(root.pathname) === 0) {
      const resp = await cache.match(key);
      if (resp) return resp;
    }
  }
  return null;
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== TILE_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Chart tiles: serve from a downloaded offline pack when present, else the
  // network. Misses are NOT auto-cached (cross-origin tiles are opaque and
  // Chrome quota-pads opaque cache entries; packs are populated explicitly by
  // offline-tiles.js from the CORS mirror instead). The cache handle is opened
  // once and reused — tiles are the hottest request path (pans/zooms fetch
  // dozens per frame burst) and a caches.open() per request measurably slows
  // tile-heavy interactions (magnifier pan perf test).
  if (url.host === TILE_HOST && url.pathname.indexOf('/tiles/') === 0) {
    if (!tilePackReady) return;   // no pack downloaded -> native network path, zero SW overhead
    if (!self._tileCachePromise) self._tileCachePromise = caches.open(TILE_CACHE);
    e.respondWith(
      self._tileCachePromise
        .then(c => c.match(e.request.url))
        .then(hit => hit || fetch(e.request)));
    return;
  }

  if (!cacheable(url)) return;            // other cross-origin (imagery/OSM) -> straight to network

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
        .catch(async () => {
          const shell = await cachedAppShell(e.request);
          return shell || Response.error();
        }));
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
        await cache.put(e.request, resp.clone());
        if (url.search.includes('v=')) {
          const keys = await cache.keys();
          for (const k of keys) {
            const ku = new URL(k.url);
            if (ku.pathname === url.pathname && k.url !== e.request.url) {
              await cache.delete(k);
            }
          }
        }
      }
      return resp;
    }));
});
