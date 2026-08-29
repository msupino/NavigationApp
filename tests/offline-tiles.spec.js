// @ts-check
// Offline chart packs (offline-tiles.js + sw.js tile branch): tiles are
// fetched from the CORS mirror but stored under the URL the map itself requests, so
// the SW can serve the map's own tile requests cache-first when offline.
const { test, expect } = require('./_setup');

// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64');

async function boot(page) {
  await page.route(/^https:\/\/navaid-tiles\.supino\.org\//, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG,
      headers: { 'access-control-allow-origin': '*' } }));
  await page.route(/^https:\/\/msupino\.github\.io\/NavigationApp-owned-tiles\//, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG,
      headers: { 'access-control-allow-origin': '*' } }));
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' &&
    window.NavAidOfflineTiles && typeof layers !== 'undefined');
}

test('offlineTileList covers the chart bounds at each zoom', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const t = NavAidOfflineTiles.offlineTileList({ south: 28.3, west: 33.7, north: 34.3, east: 36.6 }, 7, 8);
    const z7 = t.filter(c => c.z === 7), z8 = t.filter(c => c.z === 8);
    return { total: t.length, z7: z7.length, z8: z8.length,
      sample: z7[0] };
  });
  expect(r.z7).toBeGreaterThan(0);
  expect(r.z8).toBeGreaterThanOrEqual(r.z7 * 2);   // roughly 4x per zoom step
  expect(r.total).toBe(r.z7 + r.z8);
  expect(r.sample.z).toBe(7);
});

test('a defined route moves its tile corridor to the front without dropping whole-chart tiles', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const O = NavAidOfflineTiles;
    const route = [
      { lat: 32.17944, lng: 34.83444 },
      { lat: 32.79417, lng: 34.98917 },
    ];
    const original = O.cvfrPlan(10, 10);
    const ordered = O.prioritizeRouteTiles(original, route);
    const distances = ordered.map(item => O.routeTileDistanceSq(item.coords, route));
    const firstOutside = distances.findIndex(distance => distance > 2.25);
    const untouched = O.prioritizeRouteTiles(original, []).every((item, i) => item === original[i]);
    return {
      sameCount: ordered.length === original.length,
      firstIsRoute: distances[0] <= 2.25,
      routeOnlyPrefix: firstOutside > 0 && distances.slice(firstOutside).every(distance => distance > 2.25),
      noRouteKeepsOrder: untouched,
    };
  });
  expect(r).toEqual({
    sameCount: true,
    firstIsRoute: true,
    routeOnlyPrefix: true,
    noRouteKeepsOrder: true,
  });
});

test('a route added during download reprioritizes only the remaining queue', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const O = NavAidOfflineTiles;
    const route = [
      { lat: 32.17944, lng: 34.83444 },
      { lat: 32.79417, lng: 34.98917 },
    ];
    const queue = O.cvfrPlan(10, 10);
    const completedPrefix = queue.slice(0, 3);
    O.reprioritizeRemaining(queue, completedPrefix.length, route);
    const distances = queue.slice(completedPrefix.length)
      .map(item => O.routeTileDistanceSq(item.coords, route));
    const firstOutside = distances.findIndex(distance => distance > 2.25);
    return {
      prefixUntouched: completedPrefix.every((item, i) => queue[i] === item),
      nextIsRoute: distances[0] <= 2.25,
      routeOnlyRemainingPrefix: firstOutside > 0 &&
        distances.slice(firstOutside).every(distance => distance > 2.25),
    };
  });
  expect(r).toEqual({
    prefixUntouched: true,
    nextIsRoute: true,
    routeOnlyRemainingPrefix: true,
  });
});

test('downloadPack always stores CVFR, regardless of the selected map layer', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    for (const key in layers) if (map.hasLayer(layers[key])) map.removeLayer(layers[key]);
    map.addLayer(layers['Low Alt']);
    const res = await NavAidOfflineTiles.downloadPack(() => {}, 7, 7);
    const cache = await caches.open(NavAidOfflineTiles.TILE_CACHE);
    const keys = (await cache.keys()).map(k => k.url);
    // Whatever the active layer's own URL is -- flight-maps.com on the live site, our mirror
    // everywhere else -- because that is what the service worker will be asked for.
    const want = layers.CVFR._url.replace('{z}', '7');
    const prefix = want.slice(0, want.indexOf('/7/') + 3);
    return { res, n: keys.length, prefix, allLive: keys.every(u => u.indexOf(prefix) === 0) };
  });
  expect(r.res.ok).toBeGreaterThan(0);
  expect(r.n).toBe(r.res.ok);          // every fetched tile stored
  expect(r.allLive).toBe(true);        // keyed by the URL the map requests, not the fetch URL
});

test('deletePack removes the offline tiles; packSize reports the count', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    await NavAidOfflineTiles.downloadPack(() => {}, 7, 7);
    const before = await NavAidOfflineTiles.packSize();
    await NavAidOfflineTiles.deletePack();
    const after = await NavAidOfflineTiles.packSize();
    return { before, after };
  });
  expect(r.before).toBeGreaterThan(0);
  expect(r.after).toBe(0);
});

test('one compact status button opens an explicit CVFR-only manager', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    await caches.delete(NavAidOfflineTiles.TILE_CACHE);
    setTune('offlineCvfrMinZoom', 7);
    setTune('offlineCvfrMaxZoom', 7);
  });
  expect(await page.locator('#offline-tiles-group').evaluate(el => !!el.closest('[data-sec="charts"]'))).toBe(true);
  expect(page.locator('#offline-tiles-group button')).toHaveCount(1);
  await page.locator('.tb-section[data-sec="charts"] .tb-section-head').click();
  await expect(page.locator('#offline-tiles-btn')).toContainText('Download CVFR offline');
  await page.locator('#offline-tiles-btn').click();
  await expect(page.locator('.offline-manager-modal')).toBeVisible();
  await expect(page.locator('.offline-manager-layer')).toHaveText('CVFR');
  await expect(page.locator('.offline-manager-online')).toContainText('Online only');
  await expect(page.locator('.offline-manager-online')).toContainText('Navigation');
  await expect(page.locator('.offline-manager-online')).toContainText('Helicopters');
  await expect(page.locator('#offline-tiles-btn')).toContainText('ready ✓');
});

test('coverage is exact, complete packs cannot be redundantly repaired, and old layer tiles are pruned', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const O = NavAidOfflineTiles;
    await caches.delete(O.TILE_CACHE);
    const cache = await caches.open(O.TILE_CACHE);
    await cache.put('https://navaid-tiles.supino.org/Israel-Navigation/7/1/1.png',
      new Response(new Uint8Array([1]), { status: 200 }));
    const before = await O.cvfrCoverage(7, 7);
    const first = await O.downloadPack(() => {}, 7, 7);
    const complete = await O.cvfrCoverage(7, 7, { pruneOtherLayers: true });
    const second = await O.downloadPack(() => {}, 7, 7);
    const urls = (await (await caches.open(O.TILE_CACHE)).keys()).map(k => k.url);
    await caches.delete(O.TILE_CACHE);
    return { before, first, complete, second,
      hasOtherLayer: urls.some(url => url.includes('Israel-Navigation')) };
  });
  expect(r.before.complete).toBe(false);
  expect(r.complete.complete).toBe(true);
  expect(r.complete.percent).toBe(100);
  expect(r.second.fetched).toBe(0);
  expect(r.hasOtherLayer).toBe(false);
});

test('known 404 cells are cached as transparent tiles and count as complete', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const O = NavAidOfflineTiles;
    await caches.delete(O.TILE_CACHE);
    const original = window.fetch;
    let first = true;
    window.fetch = function () {
      if (first) { first = false; return Promise.resolve(new Response('', { status: 404 })); }
      return original.apply(this, arguments);
    };
    const result = await O.downloadPack(() => {}, 7, 7);
    window.fetch = original;
    const cache = await caches.open(O.TILE_CACHE);
    const responses = await Promise.all((await cache.keys()).map(key => cache.match(key)));
    const placeholders = responses.filter(response => response.headers.get('x-navaid-empty-chart-tile') === '1').length;
    const coverage = await O.cvfrCoverage(7, 7);
    await caches.delete(O.TILE_CACHE);
    return { result, placeholders, coverage };
  });
  expect(r.result.placeholders).toBe(1);
  expect(r.placeholders).toBe(1);
  expect(r.coverage.complete).toBe(true);
});

test('sw.js exempts the tile cache from activate cleanup and serves tiles cache-first', async ({ page }) => {
  await boot(page);
  // Static analysis of the SW source (registering a SW in the test harness is
  // environment-dependent): the activate filter must keep TILE_CACHE, and the
  // fetch handler must branch on the tile host BEFORE the cacheable() bailout.
  const sw = await page.evaluate(() => fetch('sw.js').then(r => r.text()));
  // The exemption survived a rewrite of the cleanup: it used to delete every navaid-*
  // cache that was not its own, which crossed service-worker scopes and let a preview or
  // staging worker wipe the PRODUCTION app-shell cache (Cache Storage is per origin).
  // Cleanup is now scope-owned; the tile bucket is still skipped outright, which is what
  // this test is really about -- a 100+ MB user download must never be collateral.
  expect(sw).toMatch(/if \(k === CACHE \|\| k === TILE_CACHE\) continue;/);
  expect(sw).toContain('ownedByThisScope');
  expect(sw).toMatch(/TILE_HOST = 'flight-maps\.com'/);
  expect(sw).toMatch(/OWNED_TILE_HOST = 'msupino\.github\.io'/);
  expect(sw).toMatch(/OWNED_TILE_PATH = '\/NavigationApp-owned-tiles\/'/);
  const tileBranch = sw.indexOf('url.host === TILE_HOST');
  const cacheableBail = sw.indexOf('if (!cacheable(url)) return');
  expect(tileBranch).toBeGreaterThan(0);
  expect(tileBranch).toBeLessThan(cacheableBail);   // tiles handled before the bailout
  // Perf invariant (issue-388): with NO pack downloaded, the SW must not
  // respondWith on tile requests at all — native network path, zero overhead.
  expect(sw).toMatch(/if \(!tilePackReady\) return/);
  expect(sw).toMatch(/tile-pack-changed/);          // page tells the SW when a pack appears
});
