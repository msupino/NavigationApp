// @ts-check
// Regressions found in a full-codebase review of the per-layer dataset
// architecture (layerDataPrefix/fetchLayerData/reloadLayerDatasets):
//  1. Switching the base layer must not silently rewrite the current route's
//     auto-derived leg altitudes.
//  2. Comm-change rings must survive a layer switch when only "show
//     comm-change" is on (not nav-waypoints/reporting).
//  3. A stale in-flight fetch from a layer the user has since switched away
//     from must not overwrite state for the now-active layer.
//  4. loadAreas() must not issue a request for a layer with no areas file.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && typeof layers !== 'undefined' &&
    typeof reloadLayerDatasets === 'function');
}
const setLayer = (page, name) => page.evaluate((n) => {
  for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
  map.addLayer(layers[n]);
}, name);

test('switching the base layer does not rewrite the current route\'s leg altitudes', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    // Build a two-waypoint route on CVFR with an auto-derived leg.
    state.waypoints = [{ lat: 32.917, lng: 35.097, name: 'AAKKO' }, { lat: 32.911, lng: 35.180, name: 'AHIUD' }];
    syncLegs();
    legAltitudeMap = null;
    await loadLegAltitudes();
    const before = { in: state.legs[0].inboundAltitude, out: state.legs[0].outboundAltitude };
    // Switch to Low Alt (mirrors what the layer <select>'s onchange does) and
    // wait for the backgrounded reload to settle.
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['Low Alt']);
    reloadLayerDatasets();
    await new Promise(r => setTimeout(r, 400));
    const after = { in: state.legs[0].inboundAltitude, out: state.legs[0].outboundAltitude };
    return { before, after };
  });
  expect(r.after).toEqual(r.before);   // unchanged by the passive layer switch
});

test('comm-change rings survive a layer switch when only "show comm-change" is on', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    showNavWP = false; showReporting = false; showCommChange = true;
    navWP = null; commChangeMap = null;
    reloadLayerDatasets();
    await new Promise(r => setTimeout(r, 400));
    return { navWP: Array.isArray(navWP) ? navWP.length : navWP, commChangeMap: commChangeMap === null ? null : Object.keys(commChangeMap).length };
  });
  expect(r.navWP).not.toBeNull();      // navWP must be (re)loaded, not left null
  expect(r.navWP).toBeGreaterThan(0);
});

test('a stale in-flight fetch from a previous layer does not overwrite the active layer\'s data', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    // Simulate: reloadLayerDatasets() runs (bumping the generation + starting
    // a fetch), then a second layer switch happens before the first fetch's
    // continuation runs. The first continuation must detect it is stale.
    navWP = null;
    const genAtStart = _layerGen;
    const p = loadNavWaypoints();   // "old" layer's in-flight load
    _layerGen++;                    // a newer layer switch supersedes it
    navWP = ['sentinel-for-new-layer'];   // the "new" layer's own load already finished
    await p;
    return { stillSentinel: Array.isArray(navWP) && navWP[0] === 'sentinel-for-new-layer', genAtStart, genNow: _layerGen };
  });
  expect(r.genNow).toBeGreaterThan(r.genAtStart);
  expect(r.stillSentinel).toBe(true);   // the stale fetch must not have clobbered navWP
});

test('loadAreas() does not fetch a network resource on the CVFR layer', async ({ page }) => {
  await boot(page);
  const reqs = [];
  page.on('request', req => { if (req.url().includes('areas.json')) reqs.push(req.url()); });
  await page.evaluate(async () => {
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['CVFR']);
    areas = null;
    await loadAreas();
  });
  expect(reqs.length).toBe(0);         // no cvfr-areas.json exists — must not be requested
});

test('loadAreas() still fetches on the Low Alt layer', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['Low Alt']);
    areas = null;
    await loadAreas();
    return areas.length;
  });
  expect(r).toBeGreaterThan(0);
});
