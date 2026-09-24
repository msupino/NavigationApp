// @ts-check
// Offline packs beyond CVFR: the other Israeli charts whole, and open flightmaps by area,
// several at once. Each pack keeps its own tiles; deleting one never takes a tile another
// pack still wants.
const { test, expect } = require('./_setup');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64');

async function boot(page) {
  const tile = r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG,
    headers: { 'access-control-allow-origin': '*' } });
  await page.route(url => url.hostname === 'navaid-tiles.supino.org', tile);
  await page.route(url => url.hostname === 'nwy-tiles-api.prod.newaydata.com', tile);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' && window.NavAidOfflineTiles && typeof layers !== 'undefined');
  await page.evaluate(async () => {
    await caches.delete(NavAidOfflineTiles.TILE_CACHE);
    localStorage.removeItem('navaid.offlinePacks');
    // Small pyramids: the whole-chart packs follow the CVFR zoom range.
    setTune('offlineCvfrMinZoom', 7);
    setTune('offlineCvfrMaxZoom', 8);
  });
}
const urls = page => page.evaluate(async () =>
  (await (await caches.open(NavAidOfflineTiles.TILE_CACHE)).keys()).map(k => k.url));

test('two whole charts download side by side, and CVFR keeping itself does not prune them', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const O = NavAidOfflineTiles;
    await O.downloadChart('Navigation');
    await O.downloadChart('Low Alt');
    await O.downloadPack(() => {}, 7, 8);                    // the automatic CVFR run prunes
    return {
      nav: await O.chartCoverage('Navigation'),
      la: await O.chartCoverage('Low Alt'),
      cvfr: await O.cvfrCoverage(7, 8),
      packs: O.readPacks(),
    };
  });
  expect(r.nav.complete).toBe(true);
  expect(r.la.complete).toBe(true);
  expect(r.cvfr.complete).toBe(true);
  expect(r.packs.charts).toEqual(['Navigation', 'Low Alt']);
  const all = await urls(page);
  expect(all.some(u => u.includes('Israel-Navigation') || u.includes('/nav/'))).toBe(true);
  expect(all.some(u => u.includes('LSA-Low-Altitude') || u.includes('/la/'))).toBe(true);
});

test('deleting one chart removes its tiles and leaves the others', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const O = NavAidOfflineTiles;
    await O.downloadChart('Navigation');
    await O.downloadChart('Low Alt');
    await O.deleteChart('Navigation');
    return { nav: await O.chartCoverage('Navigation'), la: await O.chartCoverage('Low Alt'), packs: O.readPacks() };
  });
  expect(r.nav.present).toBe(0);
  expect(r.la.complete).toBe(true);
  expect(r.packs.charts).toEqual(['Low Alt']);
});

test('clearing CVFR leaves the other packs on the device', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const O = NavAidOfflineTiles;
    await O.downloadPack(() => {}, 7, 8);
    await O.downloadChart('Navigation');
    await O.deletePack();
    return { cvfr: await O.cvfrCoverage(7, 8), nav: await O.chartCoverage('Navigation') };
  });
  expect(r.cvfr.present).toBe(0);
  expect(r.nav.complete).toBe(true);
});

test('open flightmaps downloads the area on screen, several areas, each deletable', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const O = NavAidOfflineTiles;
    const moveTo = (lat, lng, z) => new Promise(done => { map.once('moveend', () => done()); map.setView([lat, lng], z, { animate: false }); });
    await moveTo(47.26, 11.35, 11);                        // Innsbruck
    const a = O.screenArea('OpenFlightMaps');
    await O.downloadArea('OpenFlightMaps');
    await moveTo(37.9, 23.7, 11);                          // Athens
    await O.downloadArea('OpenFlightMaps');
    const packs = O.readPacks();
    const cov = await Promise.all(packs.areas.map(area => O.areaCoverage(area)));
    await O.deleteArea(packs.areas[0].id);
    const after = O.readPacks();
    const second = await O.areaCoverage(after.areas[0]);
    return { tiles: a.tiles, areas: packs.areas.length, cov, left: after.areas.length, second };
  });
  expect(r.tiles).toBeGreaterThan(0);
  expect(r.tiles).toBeLessThan(20000);
  expect(r.areas).toBe(2);
  expect(r.cov.every(c => c.complete)).toBe(true);
  expect(r.left).toBe(1);
  expect(r.second.complete).toBe(true);
  expect((await urls(page)).some(u => new URL(u).hostname === 'nwy-tiles-api.prod.newaydata.com')).toBe(true);
});

test('over Israel the area button is dimmed and says why; over Europe it is offered', async ({ page }) => {
  await boot(page);
  const moveTo = (lat, lng, z) => page.evaluate(([a, b, c]) => new Promise(done => {
    map.once('moveend', () => setTimeout(done, 50)); map.setView([a, b], c, { animate: false });
  }), [lat, lng, z]);
  await moveTo(32.1, 34.9, 10);
  await page.evaluate(() => NavAidOfflineTiles.openManager());
  const add = page.locator('.offline-area-add');
  const note = page.locator('.offline-manager-areas .offline-manager-note');
  await expect(add).toBeDisabled();
  await expect(note).toContainText('No data over Israel');
  await moveTo(47.26, 11.35, 11);                          // Innsbruck
  await expect(add).toBeEnabled();
  await expect(note).toHaveCount(0);
});

test('the service worker serves open flightmaps tiles from a pack', async ({ page }) => {
  await boot(page);
  const sw = await page.evaluate(() => fetch('sw.js').then(r => r.text()));
  expect(sw).toMatch(/OFM_TILE_HOST = 'nwy-tiles-api\.prod\.newaydata\.com'/);
  expect(sw).toMatch(/url\.host === OFM_TILE_HOST/);
});
