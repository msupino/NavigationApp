// @ts-check
// Per-layer waypoint datasets: the active base layer decides which file feeds
// navWP. Low Alt -> lsa-nav-waypoints.json, Helicopters -> heli-* (empty),
// everything else -> cvfr-nav-waypoints.json (fallback). Same overlay + click/
// inspector behaviour for all; only the data source differs.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' &&
    typeof layers !== 'undefined' && typeof loadNavWaypoints === 'function');
}
const setLayer = async (page, name) => page.evaluate(async (n) => {
  for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
  map.addLayer(layers[n]);
  window.navWP = null;                      // mimic reloadLayerDatasets()
  await loadNavWaypoints();
  return window.navWP.length;
}, name);

test('waypoint dataset follows the active base layer', async ({ page }) => {
  await boot(page);
  const cvfr = await setLayer(page, 'CVFR');
  const lsa = await setLayer(page, 'Low Alt');
  const nav = await setLayer(page, 'Navigation');   // no own file -> cvfr fallback
  const heli = await setLayer(page, 'Helicopters');  // own heli dataset
  expect(cvfr).toBeGreaterThan(150);     // ~172 CVFR
  expect(lsa).toBeGreaterThan(100);      // ~148 LSA
  expect(lsa).not.toBe(cvfr);
  expect(nav).toBe(cvfr);                // fallback to CVFR
  expect(heli).toBeGreaterThan(100);     // ~205 heli, its own dataset
  expect(heli).not.toBe(cvfr);
  expect(heli).not.toBe(lsa);
});

test('LSA waypoints draw via the shared nav-waypoint overlay', async ({ page }) => {
  await boot(page);
  const drawn = await page.evaluate(async () => {
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['Low Alt']);
    window.navWP = null; window.showNavWP = true; await loadNavWaypoints();
    map.setView([32.0, 34.9], 9);
    let n = 0; const orig = octx.arc;
    octx.arc = function (...a) { n++; return orig.apply(this, a); };
    drawNavWaypoints();
    octx.arc = orig; return n;
  });
  expect(drawn).toBeGreaterThan(0);
});

test('an LSA waypoint selects + opens the inspector, same as CVFR', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['Low Alt']);
    window.navWP = null; window.showNavWP = true; await loadNavWaypoints();
    map.setView([window.navWP[0].lat, window.navWP[0].lng], 13);
    // hit-test at the first LSA waypoint's pixel — the same code CVFR clicks use
    const s = proj(window.navWP[0]);
    const hit = hitNavWpMarker(s.x, s.y);   // returns the navWP index, or -1
    state.selected = { type: 'navwp', index: hit };
    showInspector();
    const insp = document.getElementById('inspector');
    return { hit, open: insp && !insp.classList.contains('hidden') };
  });
  expect(r.hit).toBe(0);          // LSA dot is hit-testable (index 0)
  expect(r.open).toBe(true);      // inspector opened, same path as CVFR
});

test('LSA areas (bubbles) load + draw on Low Alt, none on CVFR', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const setL = k => { for (const x in layers) if (map.hasLayer(layers[x])) map.removeLayer(layers[x]); map.addLayer(layers[k]); };
    setL('Low Alt'); window.areas = null; await loadAreas();
    const lsaCount = window.areas.length;
    const southern = window.areas.filter(a => Array.isArray(a.coords) && a.coords[0][0] < 31).length;
    map.setView([32.1, 35.0], 9);
    let fills = 0; const orig = octx.fill;
    octx.fill = function (...a) { fills++; return orig.apply(this, a); };
    drawAreas();
    octx.fill = orig;
    setL('CVFR'); window.areas = null; await loadAreas();
    const cvfrCount = window.areas.length;
    return { lsaCount, southern, fills, cvfrCount };
  });
  expect(r.lsaCount).toBeGreaterThanOrEqual(17);   // northern set + southern (Eilat-area) bubbles
  expect(r.southern).toBeGreaterThanOrEqual(4);    // the southern LSA bubbles (lat ~30)
  expect(r.fills).toBeGreaterThan(0);      // drawn on Low Alt
  expect(r.cvfrCount).toBe(0);             // no cvfr-areas file
});
