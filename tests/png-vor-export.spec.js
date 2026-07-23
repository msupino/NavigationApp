// @ts-check
// PNG export draws the VOR stations onto the exported chart whenever the export
// carries VOR info (the plan card's Radial/DME columns) — even when the live
// "Show VOR stations" toggle is off — so the reader can see where those
// readings reference. drawVors(force) bypasses the toggle for the export.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof openExportPanel === 'function' && typeof setPage === 'function' &&
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

// Run the PNG export with drawVors + the tile fetch stubbed, and return the
// array of `force` args the EXPORT passed to drawVors. `rec` is cleared right
// after exportPNG() returns (synchronously) so only the async export-overlay
// call is captured — never an incidental live draw()→drawVors(undefined). The
// poll REJECTS (fails loudly) if the export never calls drawVors, instead of
// returning [] and leaning on a length assertion / global timeout.
async function captureExportForce(page) {
  return page.evaluate(async () => {
    const rec = [];
    const orig = window.drawVors;
    window.drawVors = function (f) { rec.push(f); return orig.apply(this, arguments); };
    window.fetchTileBitmap = async () => ({ bmp: null, failed: false });   // no network
    exportPNG();
    rec.length = 0;                       // drop any synchronous pre-overlay calls
    try {
      await new Promise((res, rej) => {
        const t0 = Date.now();
        (function poll() {
          if (rec.length) return res();
          if (Date.now() - t0 > 6000) return rej(new Error('export never called drawVors'));
          setTimeout(poll, 20);
        })();
      });
    } finally { window.drawVors = orig; }
    return rec;
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
  test.setTimeout(30000);
  await page.setViewportSize({ width: 1400, height: 1000 });
  page.on('download', () => { /* swallow the export download */ });
  await boot(page);
  await route(page);
  await page.evaluate(() => { setPage('A4'); draw(); openExportPanel(); });
  await page.locator('#export-plan-cb').check();
  await page.locator('#export-vor-select').selectOption('NAT');   // VOR info in the plan card
  await page.evaluate(() => { window.showVorStations = false; });  // live overlay OFF

  const force = await captureExportForce(page);
  expect(force.length).toBeGreaterThan(0);
  expect(force.every(Boolean)).toBe(true);        // export forced despite the toggle being off
});

test('export does NOT force VOR stations when there is no VOR info', async ({ page }) => {
  test.setTimeout(30000);
  await page.setViewportSize({ width: 1400, height: 1000 });
  page.on('download', () => { /* swallow the export download */ });
  await boot(page);
  await route(page);
  await page.evaluate(() => { setPage('A4'); draw(); openExportPanel(); });
  await page.locator('#export-plan-cb').check();
  await page.locator('#export-vor-select').selectOption('');      // no reference VOR
  await page.evaluate(() => {
    window.showVorStations = false;
    window.vorRef = null;
    state.legs.forEach(l => { if (l) l.vorRef = null; });
  });

  const force = await captureExportForce(page);
  expect(force.length).toBeGreaterThan(0);        // drawVors is still called
  expect(force.every(f => !f)).toBe(true);        // …but never forced (no VOR info)
});

test('export does NOT force VOR stations for a stale reference-VOR ident (not in the dataset)', async ({ page }) => {
  test.setTimeout(30000);
  await page.setViewportSize({ width: 1400, height: 1000 });
  page.on('download', () => { /* swallow the export download */ });
  await boot(page);
  await route(page);
  await page.evaluate(() => { setPage('A4'); draw(); openExportPanel(); });
  await page.locator('#export-plan-cb').check();
  await page.evaluate(() => {
    window.showVorStations = false;
    window.vorRef = 'ZZZZ';                        // ident absent from `vors`
    state.legs.forEach(l => { if (l) l.vorRef = null; });
  });

  const force = await captureExportForce(page);
  // activeVor() can't resolve 'ZZZZ' so the plan card shows no Radial/DME
  // columns → the export must NOT force the stations (matches the card's gate).
  expect(force.every(f => !f)).toBe(true);
});
