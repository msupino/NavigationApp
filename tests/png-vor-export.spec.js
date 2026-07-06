// @ts-check
// PNG export draws the VOR stations onto the exported chart whenever the export
// carries VOR info (the plan card's Radial/DME columns) — even when the live
// "Show VOR stations" toggle is off — so the reader can see where those
// readings reference. drawVors(force) bypasses the toggle for the export.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof showExportModal === 'function' && typeof setPage === 'function' &&
    typeof exportPNG === 'function' && typeof drawVors === 'function' &&
    typeof loadVors === 'function');
}

async function route(page) {
  await page.evaluate(async () => {
    if (typeof loadVors === 'function') { try { await loadVors(); } catch (e) {} }
    state.waypoints = [
      { lat: 32.18, lng: 34.83, name: 'LLHZ' },
      { lat: 32.44, lng: 34.90, name: 'HADERA' },
      { lat: 32.70, lng: 35.57, name: 'LLIB' },
    ];
    state.legs = []; syncLegs();
    fitView();
  });
}

test('drawVors(force) draws stations even when the Show VOR stations toggle is off', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    await loadVors();
    window.vorRef = 'NAT';
    window.showVorStations = false;              // live overlay OFF
    // Spy on ring/dot arcs painted by drawVors onto the overlay canvas.
    const realArc = octx.arc.bind(octx);
    let n = 0;
    octx.arc = function () { n++; return realArc.apply(octx, arguments); };
    n = 0; drawVors(false);  const off = n;      // toggle off, not forced → nothing
    n = 0; drawVors(true);   const on = n;       // forced → stations drawn
    octx.arc = realArc;
    return { off, on };
  });
  expect(r.off).toBe(0);           // toggle off + no force → no VOR glyphs
  expect(r.on).toBeGreaterThan(0); // forced → glyphs painted despite the toggle
});

test('export forces the VOR stations when the plan card carries VOR info (toggle off)', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  page.on('download', () => { /* swallow the export download */ });
  await boot(page);
  await route(page);
  await page.evaluate(() => { setPage('A4'); draw(); showExportModal(); });
  await page.locator('#export-plan-cb').check();
  await page.locator('#export-vor-select').selectOption('NAT');   // VOR info in the plan card

  const force = await page.evaluate(async () => {
    window.showVorStations = false;                              // live overlay OFF
    const rec = [];
    const orig = window.drawVors;
    window.drawVors = function (f) { rec.push(f); return orig.apply(this, arguments); };
    window.fetchTileBitmap = async () => ({ bmp: null, failed: false });   // no network
    exportPNG();
    await new Promise(res => {
      const t0 = Date.now();
      (function poll() { if (rec.length || Date.now() - t0 > 8000) return res(); setTimeout(poll, 30); })();
    });
    window.drawVors = orig;
    return rec;
  });
  expect(force.length).toBeGreaterThan(0);
  expect(force.some(Boolean)).toBe(true);        // forced despite the toggle being off
});

test('export does NOT force VOR stations when there is no VOR info', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  page.on('download', () => { /* swallow the export download */ });
  await boot(page);
  await route(page);
  await page.evaluate(() => { setPage('A4'); draw(); showExportModal(); });
  await page.locator('#export-plan-cb').check();
  await page.locator('#export-vor-select').selectOption('');      // no reference VOR

  const force = await page.evaluate(async () => {
    window.showVorStations = false;
    window.vorRef = null;
    state.legs.forEach(l => { if (l) l.vorRef = null; });
    const rec = [];
    const orig = window.drawVors;
    window.drawVors = function (f) { rec.push(f); return orig.apply(this, arguments); };
    window.fetchTileBitmap = async () => ({ bmp: null, failed: false });
    exportPNG();
    await new Promise(res => {
      const t0 = Date.now();
      (function poll() { if (rec.length || Date.now() - t0 > 8000) return res(); setTimeout(poll, 30); })();
    });
    window.drawVors = orig;
    return rec;
  });
  expect(force.length).toBeGreaterThan(0);        // drawVors is still called
  expect(force.every(f => !f)).toBe(true);        // …but never forced (no VOR info)
});
