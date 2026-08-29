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

test('downloadPack stores tiles under the URL the map will request', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    // chart layer active by default (CVFR)
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

test('the download button shows only on chart layers (has a CORS mirror)', async ({ page }) => {
  await boot(page);
  // The group lives in the Charts toolbar section.
  expect(await page.locator('#offline-tiles-group').evaluate(el => !!el.closest('[data-sec="charts"]'))).toBe(true);
  const r = await page.evaluate(async () => {
    const grp = document.getElementById('offline-tiles-group');
    const setL = k => { for (const x in layers) if (map.hasLayer(layers[x])) map.removeLayer(layers[x]); map.addLayer(layers[k]); };
    const onChart = !grp.hidden || grp.hidden;   // read after each switch below
    setL('CVFR'); await new Promise(r2 => setTimeout(r2, 50));
    const cvfr = !document.getElementById('offline-tiles-group').hidden;
    setL('OpenStreetMap'); await new Promise(r2 => setTimeout(r2, 50));
    const osm = !document.getElementById('offline-tiles-group').hidden;
    setL('Low Alt'); await new Promise(r2 => setTimeout(r2, 50));
    const lsa = !document.getElementById('offline-tiles-group').hidden;
    return { cvfr, osm, lsa, onChart };
  });
  expect(r.cvfr).toBe(true);     // chart layer → button shown
  expect(r.osm).toBe(false);     // no mirror → hidden
  expect(r.lsa).toBe(true);      // chart layer → shown
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
