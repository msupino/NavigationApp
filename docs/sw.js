/* NavAid service worker — installable PWA + offline app shell.
   Map tiles (cross-origin or local MBTiles-backed, large) are left to the network. */
const CACHE = 'navaid-v6';
// Offline chart packs (offline-tiles.js): a dedicated bucket so the activate
// cleanup never wipes a 100+ MB user download on a service-worker upgrade.
const TILE_CACHE = 'navaid-tiles-v1';
// Chart tiles come from the third party on the live site and from our own mirror everywhere
// else (see liveChartTilesAllowed in core.js), so an offline pack is keyed by whichever host
// the map will actually request. Both are served from the pack.
const TILE_HOST = 'flight-maps.com';
const MIRROR_TILE_HOST = 'navaid-tiles.supino.org';
function isChartTileRequest(url) {
  if (url.host === TILE_HOST) return url.pathname.indexOf('/tiles/') === 0;
  return url.host === MIRROR_TILE_HOST;
}
// Tiles are the hottest request path (pans fetch dozens in a burst), so the
// SW only proxies them when a pack actually exists — otherwise the fetch
// handler returns without respondWith and the browser's native network path
// handles the tile with zero SW overhead (issue-388 magnifier perf).
// Tri-state: null = unknown (the caches.has probe is in flight), else true/false.
// The SW is terminated when idle, so every cold start re-runs the probe -- and a
// pan's burst of tile requests can arrive BEFORE it resolves. Treating unknown as
// "no pack" sent that burst to the network, which offline means blank tiles
// despite a downloaded pack. Unknown now takes the proxied path and awaits the
// probe; the zero-overhead native path still applies once the flag settles false.
let tilePackReady = null;
function refreshTilePackFlag() {
  // Drop any memoized cache handle: a delete+re-download replaces the underlying
  // Cache, so a handle opened before the change would match() against the old
  // (now detached) bucket and miss every freshly-downloaded tile.
  self._tileCachePromise = null;
  tilePackReady = null;
  self._tilePackProbe = caches.has(TILE_CACHE)
    .then(h => { tilePackReady = h; return h; }, () => { tilePackReady = false; return false; });
  return self._tilePackProbe;
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

// Cache Storage is per ORIGIN, not per service-worker scope. The activate cleanup used to
// delete every navaid-* cache except its own, so a worker registered under /pr/<n>/ or
// /staging/ wiped the PRODUCTION app-shell cache: merely opening a preview left a pilot
// without the offline shell until they next loaded the live app online. Each worker now
// stamps its own scope into its cache and deletes only caches carrying that same stamp.
const SCOPE = String((self.registration && self.registration.scope) || '/');
const SCOPE_KEY = '__navaid_owner__';

async function stampOwner() {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(SCOPE_KEY, new Response(SCOPE));
  } catch (e) { /* storage unavailable: cleanup below simply keeps everything */ }
}

async function ownedByThisScope(name) {
  try {
    const cache = await caches.open(name);
    const marked = await cache.match(SCOPE_KEY);
    if (!marked) return false;          // unmarked = another deployment, or pre-stamp: keep
    return (await marked.text()) === SCOPE;
  } catch (e) { return false; }
}

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(stampOwner());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    await stampOwner();
    const ks = await caches.keys();
    for (const k of ks) {
      if (k === CACHE || k === TILE_CACHE) continue;
      // Only this deployment's own superseded caches.
      if (await ownedByThisScope(k)) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Build probe (APK self-update — ui.js checkApkForUpdate): always straight to
  // the network, never cached, so a resumed WebView reads the live build id
  // instead of the SW's own cached copy of sw.js.
  if (url.searchParams.has('fresh')) { e.respondWith(fetch(e.request)); return; }

  // Chart tiles: serve from a downloaded offline pack when present, else the
  // network. Misses are NOT auto-cached (cross-origin tiles are opaque and
  // Chrome quota-pads opaque cache entries; packs are populated explicitly by
  // offline-tiles.js from the CORS mirror instead). The cache handle is opened
  // once and reused — tiles are the hottest request path (pans/zooms fetch
  // dozens per frame burst) and a caches.open() per request measurably slows
  // tile-heavy interactions (magnifier pan perf test).
  if (isChartTileRequest(url)) {
    if (tilePackReady === false) return;   // known no pack -> native network path, zero SW overhead
    e.respondWith((async () => {
      if (tilePackReady === null) { try { await self._tilePackProbe; } catch (err) {} }
      if (!tilePackReady) return fetch(e.request);
      if (!self._tileCachePromise) self._tileCachePromise = caches.open(TILE_CACHE);
      try {
        const cache = await self._tileCachePromise;
        const hit = await cache.match(e.request.url);
        if (hit) return hit;
      } catch (err) {
        // Only a broken/detached cache HANDLE lands here (open/match rejected) —
        // drop it so the next request re-opens. A plain cache miss does NOT throw,
        // so this never fires on the normal offline-miss path (which must fall
        // through to a single network fetch, not reset the memoized handle).
        self._tileCachePromise = null;
      }
      return fetch(e.request);   // miss or reset handle -> network (its rejection is the normal offline result)
    })());
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
