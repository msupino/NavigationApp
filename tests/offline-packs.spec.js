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

test('an area already kept is not saved again, and a new area starts at once beside CVFR', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const O = NavAidOfflineTiles;
    await new Promise(d => { map.once('moveend', d); map.setView([47.43, 19.26], 11, { animate: false }); });
    // CVFR's whole-country download running must not hold the area back.
    const cvfr = O.downloadPack(() => {}, 7, 8);
    const first = O.downloadArea('OpenFlightMaps');
    const second = await O.downloadArea('OpenFlightMaps');     // same screen: refused
    await first;
    await cvfr;
    return { areas: O.readPacks().areas.length, second, covered: O.screenArea('OpenFlightMaps').covered };
  });
  expect(r.areas).toBe(1);
  expect(r.second).toBe(null);
  expect(r.covered).toBe(true);
  await page.evaluate(() => NavAidOfflineTiles.openManager());
  await expect(page.locator('.offline-area-add')).toBeDisabled();
  await expect(page.locator('.offline-manager-areas .offline-manager-note')).toContainText('already downloaded');
  // A pack's status is its own, never CVFR's checking line.
  await expect(page.locator('.offline-manager-area .offline-manager-state')).not.toContainText('CVFR');
});

test('every chart zooms out to a continent, and the gist can raise the floor', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const sel = document.getElementById('layer-select');
    const choose = n => { sel.value = n; sel.dispatchEvent(new Event('change')); };
    const floors = {};
    for (const n of ['CVFR', 'OpenFlightMaps', 'World']) { choose(n); floors[n] = map.getMinZoom(); }
    choose('CVFR');
    map.setView([48, 10], 3, { animate: false });
    const out = map.getZoom();
    setTune('mapMinZoom', 8);
    redrawAfterTune();                               // what a gist / tuning change runs
    return { floors, out, raised: map.getMinZoom(), zoomAfter: map.getZoom() };
  });
  expect(r.floors).toEqual({ CVFR: 2, OpenFlightMaps: 2, World: 2 });
  expect(r.out).toBe(3);                             // Europe in one screen, on CVFR
  expect(r.raised).toBe(8);
  expect(r.zoomAfter).toBeGreaterThanOrEqual(8);     // Leaflet zooms in to the new floor
});

test('most of Europe: the detail levels say their size, the ones too big are dimmed', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => new Promise(done => {
    const sel = document.getElementById('layer-select');
    sel.value = 'OpenFlightMaps'; sel.dispatchEvent(new Event('change'));
    map.once('moveend', () => done());
    map.fitBounds([[35, -11], [62, 32]], { animate: false });
  }));
  const a = await page.evaluate(() => NavAidOfflineTiles.screenArea('OpenFlightMaps'));
  const z12 = a.levels.find(l => l.z === 12);
  const z10 = a.levels.find(l => l.z === 10);
  expect(z12.fits).toBe(false);                 // hundreds of thousands of tiles
  expect(z10.fits).toBe(true);
  expect(a.maxZ).toBeGreaterThanOrEqual(10);    // the most detail that fits is the default
  expect(a.maxZ).toBeLessThan(12);
  await page.evaluate(() => NavAidOfflineTiles.openManager());
  const opts = await page.locator('.offline-area-zoom option').evaluateAll(os => os.map(o => ({ z: o.value, disabled: o.disabled, text: o.textContent })));
  expect(opts.find(o => o.z === '12').disabled).toBe(true);
  expect(opts.find(o => o.z === '10').disabled).toBe(false);
  expect(opts.find(o => o.z === '10').text).toMatch(/tiles · ≈ [\d.]+ (MB|GB)/);
  await expect(page.locator('.offline-area-add')).toBeEnabled();
});

test('the chosen detail is what the area keeps', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const O = NavAidOfflineTiles;
    await new Promise(d => { map.once('moveend', d); map.setView([47.26, 11.35], 11, { animate: false }); });
    await O.downloadArea('OpenFlightMaps', 9);
    const area = O.readPacks().areas[0];
    return { maxZ: area.maxZ, top: Math.max(...O.areaPlan(area).map(i => i.coords.z)), covered9: O.screenArea('OpenFlightMaps') };
  });
  expect(r.maxZ).toBe(9);
  expect(r.top).toBe(9);
});
