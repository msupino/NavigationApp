// @ts-check
// LSA reporting-point overlay: shown only on the "Low Alt" base layer, drawn
// from docs/data/lsa-waypoints.json. Data-only points (some unnamed).
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try { for (const k of Object.keys(localStorage)) localStorage.removeItem(k); } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof map !== 'undefined' && typeof layers !== 'undefined' &&
    typeof loadLsaWaypoints === 'function' && typeof drawLsaWaypoints === 'function');
}

test('LSA waypoints load and the overlay is gated to the Low Alt layer', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['Low Alt']);
    await loadLsaWaypoints();
    const onLowAlt = lsaViewActive();
    // switch to CVFR → overlay must be inactive
    map.removeLayer(layers['Low Alt']); map.addLayer(layers['CVFR']);
    const onCvfr = lsaViewActive();
    return { count: Array.isArray(lsaWP) ? lsaWP.length : -1, onLowAlt, onCvfr };
  });
  expect(r.count).toBeGreaterThan(0);
  expect(r.onLowAlt).toBe(true);
  expect(r.onCvfr).toBeFalsy();
});

test('overlay draws triangles only on the Low Alt layer', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['Low Alt']);
    await loadLsaWaypoints();
    map.setView([31.92, 34.78], 12);
    const count = () => {
      let m = 0; const orig = octx.moveTo;
      octx.moveTo = function (x, y) { m++; return orig.call(this, x, y); };
      drawLsaWaypoints();
      octx.moveTo = orig; return m;
    };
    const onLowAlt = count();
    map.removeLayer(layers['Low Alt']); map.addLayer(layers['CVFR']);
    const onCvfr = count();
    return { onLowAlt, onCvfr };
  });
  expect(r.onLowAlt).toBeGreaterThan(0);   // triangles drawn
  expect(r.onCvfr).toBe(0);                // nothing drawn off the LSA layer
});

test('CVFR nav-waypoints are hidden on the LSA layer', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    showNavWP = true;
    await (typeof loadNavWaypoints === 'function' ? loadNavWaypoints() : null);
    map.setView([32.1, 34.85], 11);
    const drawn = () => {
      let m = 0; const orig = octx.arc;
      octx.arc = function (...a) { m++; return orig.apply(this, a); };
      drawNavWaypoints();
      octx.arc = orig; return m;
    };
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['CVFR']); const onCvfr = drawn();
    map.removeLayer(layers['CVFR']); map.addLayer(layers['Low Alt']); const onLsa = drawn();
    return { onCvfr, onLsa };
  });
  expect(r.onCvfr).toBeGreaterThan(0);     // CVFR dots drawn on the CVFR layer
  expect(r.onLsa).toBe(0);                 // suppressed on the LSA layer
});
