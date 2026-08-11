// @ts-check
// Regressions in the per-layer dataset architecture (layerDataPrefix /
// fetchLayerData / reloadLayerDatasets / routeAltPrefix pin):
//  1. A passive base-layer switch must not rewrite the route's auto leg
//     altitudes — and neither may the NEXT route edit after the switch
//     (syncLegs re-applies from the table; the routeAltPrefix pin gates it).
//  2. Comm-change rings must survive a layer switch when only "show
//     comm-change" is on (not nav-waypoints/reporting).
//  3. A stale in-flight fetch from a layer the user has since switched away
//     from must not overwrite state for the now-active layer.
//  4. loadAreas() must not issue a request for a layer with no areas file.
//  5. Clearing the route unpins it, so a fresh route re-derives from the
//     then-active layer's table.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && typeof layers !== 'undefined' &&
    typeof reloadLayerDatasets === 'function');
}

test('layer switch + subsequent edit never rewrite a pinned route\'s altitudes', async ({ page }) => {
  await boot(page);
  // Build a CVFR route whose leg exists in the CVFR table (AAKKO-AHIUD).
  await page.evaluate(async () => {
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['CVFR']);
    window.legAltitudeMap = null; window.routeAltPrefix = null;
    await loadLegAltitudes();
    state.waypoints = [{ lat: 32.917, lng: 35.097, name: 'AAKKO' }, { lat: 32.911, lng: 35.180, name: 'AHIUD' }];
    syncLegs();                       // applies + pins the route to 'cvfr'
  });
  const before = await page.evaluate(() =>
    ({ in: state.legs[0].inboundAltitude, out: state.legs[0].outboundAltitude, pin: window.routeAltPrefix }));
  expect(before.pin).toBe('cvfr');
  expect(Number.isFinite(before.in) || Number.isFinite(before.out)).toBe(true);  // table applied

  // Passive switch to Low Alt, wait for the reload to fully settle.
  await page.evaluate(() => {
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['Low Alt']);
    reloadLayerDatasets();
  });
  await page.waitForFunction(() => window.legAltitudeMap !== null && window.legAltitudeMapPrefix === 'lsa');

  // Neither the switch itself NOR a route edit afterwards may re-derive.
  const after = await page.evaluate(() => {
    syncLegs();                       // the edit path that used to rewrite
    applyLegAltitudesToRoute();       // belt-and-braces: direct apply attempt
    return { in: state.legs[0].inboundAltitude, out: state.legs[0].outboundAltitude, pin: window.routeAltPrefix };
  });
  expect(after.pin).toBe('cvfr');     // still pinned to the layer it was built on
  expect(String(after.in)).toBe(String(before.in));
  expect(String(after.out)).toBe(String(before.out));
});

test('extending a pinned route after a layer switch does not fill the new leg from the wrong table', async ({ page }) => {
  await boot(page);
  // Build + pin on CVFR, passively switch to Low Alt, then ADD a waypoint:
  // syncLegs' grow loop fills fresh legs via applyLegAltitudeToLeg directly,
  // which used to bypass the pin gate and mix two layers' altitudes.
  await page.evaluate(async () => {
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['CVFR']);
    window.legAltitudeMap = null; window.routeAltPrefix = null;
    await loadLegAltitudes();
    state.waypoints = [{ lat: 32.917, lng: 35.097, name: 'AAKKO' }, { lat: 32.911, lng: 35.180, name: 'AHIUD' }];
    syncLegs();
  });
  await page.evaluate(() => {
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['Low Alt']);
    return reloadLayerDatasets();
  });
  const r = await page.evaluate(() => {
    // Extend the route with the ALMOG→ZUKIM pair — a segment present in BOTH
    // tables with different altitudes (LSA 500/500 vs CVFR 3500/4000), so a
    // pin-bypassing fill from the loaded LSA table is detectable.
    state.waypoints.push({ lat: 31.79, lng: 35.45, name: 'ALMOG' });
    state.waypoints.push({ lat: 31.72, lng: 35.45, name: 'ZUKIM' });
    syncLegs();
    const leg = state.legs[2];           // the ALMOG→ZUKIM leg
    return { pin: window.routeAltPrefix, mapPrefix: window.legAltitudeMapPrefix,
             in: leg.inboundAltitude, out: leg.outboundAltitude };
  });
  expect(r.pin).toBe('cvfr');            // still pinned to the build layer
  expect(r.mapPrefix).toBe('lsa');       // the wrong-layer table IS loaded
  // The new leg must NOT be filled from the Low Alt table (500/500).
  expect(Number.isFinite(r.in)).toBe(false);
  expect(Number.isFinite(r.out)).toBe(false);
});

test('undo restores the route\'s altitude-layer pin from the snapshot', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['CVFR']);
    window.legAltitudeMap = null; window.routeAltPrefix = null;
    await loadLegAltitudes();
    state.waypoints = [{ lat: 32.917, lng: 35.097, name: 'AAKKO' }, { lat: 32.911, lng: 35.180, name: 'AHIUD' }];
    syncLegs();
    draw();                                    // persist() pushes the undo snapshot
    const pinned = window.routeAltPrefix;
    state.waypoints = []; syncLegs(); draw();  // clear → unpin (and snapshot)
    const cleared = window.routeAltPrefix;
    undo();                                    // restore the pinned route
    return { pinned, cleared, restored: window.routeAltPrefix, wps: state.waypoints.length };
  });
  expect(r.pinned).toBe('cvfr');
  expect(r.cleared).toBeNull();
  expect(r.wps).toBe(2);
  expect(r.restored).toBe('cvfr');   // pin came back with the snapshot
});

test('clearing the route unpins it; a fresh route repins to the active layer', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['CVFR']);
    window.legAltitudeMap = null; window.routeAltPrefix = null;
    await loadLegAltitudes();
    state.waypoints = [{ lat: 32.917, lng: 35.097, name: 'AAKKO' }, { lat: 32.911, lng: 35.180, name: 'AHIUD' }];
    syncLegs();
    const pinned = window.routeAltPrefix;
    state.waypoints = []; syncLegs();          // emptying the route unpins
    const unpinned = window.routeAltPrefix;
    return { pinned, unpinned };
  });
  expect(r.pinned).toBe('cvfr');
  expect(r.unpinned).toBeNull();
});

test('comm-change rings survive a layer switch when only "show comm-change" is on', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    window.showNavWP = false; window.showReporting = false; window.showCommChange = true;
    window.navWP = null; window.commChangeMap = null;
    reloadLayerDatasets();
  });
  await page.waitForFunction(() => Array.isArray(window.navWP) && window.navWP.length > 0 &&
    window.commChangeMap !== null);
  const n = await page.evaluate(() => window.navWP.length);
  expect(n).toBeGreaterThan(0);
});

test('a stale in-flight fetch from a previous layer does not overwrite the active layer\'s data', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    window.navWP = null;
    const genAtStart = window._layerGen;
    const p = loadNavWaypoints();          // "old" layer's in-flight load
    window._layerGen++;                    // a newer layer switch supersedes it
    window.navWP = ['sentinel-for-new-layer'];   // the "new" layer's own load already finished
    await p;
    return { stillSentinel: Array.isArray(window.navWP) && window.navWP[0] === 'sentinel-for-new-layer', genAtStart, genNow: window._layerGen };
  });
  expect(r.genNow).toBeGreaterThan(r.genAtStart);
  expect(r.stillSentinel).toBe(true);      // the stale fetch must not have clobbered navWP
});

test('loadAreas() does not fetch a network resource on the CVFR layer', async ({ page }) => {
  await boot(page);
  const reqs = [];
  page.on('request', req => { if (req.url().includes('areas.json')) reqs.push(req.url()); });
  await page.evaluate(async () => {
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['CVFR']);
    window.areas = null;
    await loadAreas();
  });
  expect(reqs.length).toBe(0);             // no cvfr-areas.json exists — must not be requested
});

test('loadAreas() still fetches on the Low Alt layer', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['Low Alt']);
    window.areas = null;
    await loadAreas();
    return window.areas.length;
  });
  expect(r).toBeGreaterThan(0);
});

test('editor "Load known" refuses layers without a known set and refuses the cvfr fallback', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&editor=1');
  await page.waitForSelector('#editor-panel');
  await page.waitForFunction(() => typeof layers !== 'undefined');
  const alerts = [];
  page.on('dialog', d => { alerts.push(d.message()); d.accept(); });
  // Satellite: no known set — must alert and import nothing.
  await page.evaluate(() => {
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['Satellite']);
  });
  await page.click('#ed-load');
  // The alert is async (dialog event) — poll for it instead of sleeping.
  await expect.poll(() => alerts.some(m => /No known waypoint set/.test(m))).toBe(true);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.editor.points') || '[]').length);
  expect(stored).toBe(0);
  // Low Alt whose own dataset failed to load: must alert and import nothing.
  //
  // Load known reads the RAW graph now (routeGraphData), which fetches ONE explicit
  // prefix and rejects if it 404s -- it has no cvfr fallback, unlike fetchLayerData.
  // So "cvfr points tagged as Low Alt" is not merely refused, it can no longer be
  // produced. What is still worth asserting is the other half: a failed load must not
  // import anything. Stub the rejection directly -- the service worker bypasses
  // page.route().
  await page.evaluate(() => {
    window.routeGraphData = () => Promise.reject(new Error('HTTP 404'));
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['Low Alt']);
  });
  await page.click('#ed-load');
  await expect.poll(() => alerts.some(m => /failed to load|Failed to load|fallback/i.test(m))).toBe(true);
  const stored2 = await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.editor.points') || '[]').length);
  expect(stored2).toBe(0);                 // CVFR points must NOT be imported as Low Alt
});
