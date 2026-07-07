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

test('LSA bubble chart: list button appears on Low Alt, modal lists bubbles, row zooms + highlights', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    for (const x in layers) if (map.hasLayer(layers[x])) map.removeLayer(layers[x]);
    map.addLayer(layers['Low Alt']);
    if (typeof reloadLayerDatasets === 'function') await reloadLayerDatasets(); else { window.areas = null; await loadAreas(); }
  });
  // the list button lives in the Charts section (not the Extra-layers group).
  expect(await page.locator('#lsa-list-btn').evaluate(el => !!el.closest('[data-sec="charts"]'))).toBe(true);
  // control group (Extra layers, toggle) + Charts button revealed on Low Alt
  // (checked via the hidden attribute; the section may be collapsed so
  // toBeVisible() is unreliable).
  expect(await page.locator('#lsa-group').evaluate(el => el.hidden)).toBe(false);
  expect(await page.locator('#lsa-list-btn').evaluate(el => el.hidden)).toBe(false);
  // ...and the whole group hides again on a non-LSA layer.
  await page.evaluate(async () => {
    for (const x in layers) if (map.hasLayer(layers[x])) map.removeLayer(layers[x]);
    map.addLayer(layers['CVFR']);
    if (typeof reloadLayerDatasets === 'function') await reloadLayerDatasets(); else { window.areas = null; await loadAreas(); }
  });
  expect(await page.locator('#lsa-group').evaluate(el => el.hidden)).toBe(true);
  // back to Low Alt for the chart interaction below.
  await page.evaluate(async () => {
    for (const x in layers) if (map.hasLayer(layers[x])) map.removeLayer(layers[x]);
    map.addLayer(layers['Low Alt']);
    if (typeof reloadLayerDatasets === 'function') await reloadLayerDatasets(); else { window.areas = null; await loadAreas(); }
  });
  const r = await page.evaluate(() => {
    areas[0].en = 'Test Area';       // name one bubble → localized label in the list
    showLsaChart();
    const m = document.querySelector('.modal-back[data-chart-modal="lsa-list"]');
    const rows = [...m.querySelectorAll('.lsa-row')];
    const named = rows.some(x => /Test Area/.test(x.textContent));
    rows[0].click();                 // zoom + highlight + close
    return { rowCount: rows.length, named, hl: !!window.__lsaHighlight, closed: !document.querySelector('.modal-back[data-chart-modal="lsa-list"]') };
  });
  expect(r.rowCount).toBeGreaterThanOrEqual(26);
  expect(r.named).toBe(true);        // areaLabel() shows the English name
  expect(r.hl).toBe(true);           // row click set the map highlight
  expect(r.closed).toBe(true);       // modal closed after selecting
});

test('weekend/always LSA bubbles use the legend colours and are tagged in the list', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    for (const x in layers) if (map.hasLayer(layers[x])) map.removeLayer(layers[x]);
    map.addLayer(layers['Low Alt']); window.areas = null; await loadAreas();
    areas[0].active = 'weekend'; areas[0].en = 'WKND';
    areas[1].active = 'always'; areas[1].en = 'ALWY';
    map.setView([32.1, 35.0], 10);
    // capture the stroke colour used for each polygon outline
    const strokes = []; const os = octx.stroke;
    octx.stroke = function () { strokes.push(String(octx.strokeStyle)); return os.apply(this, arguments); };
    drawAreas();
    octx.stroke = os;
    showLsaChart();
    const rows = [...document.querySelectorAll('.lsa-row')];
    const wk = rows.find(x => /WKND/.test(x.textContent));
    const al = rows.find(x => /ALWY/.test(x.textContent));
    const res = {
      weekendStroke: strokes.includes('#2b2b2b'),   // black outline
      alwaysStroke: strokes.includes('#3c8f3c'),     // green outline
      wkTag: /weekend/.test(wk.textContent), wkClass: wk.classList.contains('lsa-row-weekend'),
      alTag: /weekend/.test(al.textContent), alClass: al.classList.contains('lsa-row-weekend')
    };
    document.querySelector('.modal-back[data-chart-modal="lsa-list"]')?._navaidClose?.();
    return res;
  });
  expect(r.weekendStroke).toBe(true);   // weekend = black outline
  expect(r.alwaysStroke).toBe(true);    // always = green outline
  expect(r.wkTag).toBe(true);
  expect(r.wkClass).toBe(true);
  expect(r.alTag).toBe(false);          // always-type: no tag, no weekend row class
  expect(r.alClass).toBe(false);
});

test('"Show LSA bubbles" toggle (Extra layers) hides/shows the overlay and persists', async ({ page }) => {
  await boot(page);
  const cb = page.locator('#lsa-cb');
  await expect(cb).toBeChecked();          // default on
  const r = await page.evaluate(async () => {
    for (const x in layers) if (map.hasLayer(layers[x])) map.removeLayer(layers[x]);
    map.addLayer(layers['Low Alt']); window.areas = null; await loadAreas();
    map.setView([31.4, 34.9], 9);
    const fills = () => { let n = 0; const o = octx.fill; octx.fill = function (...a) { n++; return o.apply(this, a); }; drawAreas(); octx.fill = o; return n; };
    const el = document.getElementById('lsa-cb');
    el.checked = false; el.dispatchEvent(new Event('change'));
    const off = { fills: fills(), g: window.showLsaBubbles, ls: localStorage.getItem('navaid.showLsaBubbles') };
    el.checked = true; el.dispatchEvent(new Event('change'));
    const on = { fills: fills(), g: window.showLsaBubbles, ls: localStorage.getItem('navaid.showLsaBubbles') };
    return { off, on };
  });
  expect(r.off.fills).toBe(0);             // hidden when off
  expect(r.off.g).toBe(false);
  expect(r.off.ls).toBe('0');              // persisted
  expect(r.on.fills).toBeGreaterThan(0);   // shown again
  expect(r.on.ls).toBe('1');
});
