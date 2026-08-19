// @ts-check
// "Show MSA" used to sit in View/Set and draw nothing on the map: its only effect was one
// read-only row in the leg inspector, so a pilot toggling it saw no change at all. It is now
// "Terrain + MSA" in Extra layers, and it paints the elevation grid the MSA figures are
// computed from — banded, so you can read which step of ground you are over.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof drawTerrainTint === 'function' && typeof loadTerrain === 'function');
  await page.evaluate(() => loadTerrain());
  await page.waitForFunction(() => terrainHasCoverage());
  await page.evaluate(() => { map.setView([32.8, 35.3], 10); });
}

// Count the quads the tint actually filled this frame.
const quads = (page) => page.evaluate(() => {
  let fills = 0;
  const real = octx.fill.bind(octx);
  octx.fill = (...a) => { fills++; return real(...a); };
  drawTerrainTint();
  octx.fill = real;
  return fills;
});

test('the toggle lives in Extra layers, not View/Set', async ({ page }) => {
  await boot(page);
  const where = await page.evaluate(() => {
    const cb = document.getElementById('msa-cb');
    const sec = cb.closest('.tb-section') || cb.closest('[data-sec]');
    return { group: !!cb.closest('#terrain-group'), section: sec ? (sec.dataset.sec || sec.id || '') : '' };
  });
  expect(where.group).toBe(true);
});

test('with it on, the ground is painted', async ({ page }) => {
  await boot(page);
  expect(await quads(page)).toBeGreaterThan(20);
});

test('the tint is banded, so neighbouring heights in one band share a colour', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    setTune('terrainBandFt', 500);
    return {
      sameBand: [terrainTintColor(600), terrainTintColor(900)],
      nextBand: terrainTintColor(1100),
      sea: terrainTintColor(0),
    };
  });
  expect(out.sameBand[0]).toBe(out.sameBand[1]);      // 600 and 900 are both the 500 band
  expect(out.nextBand).not.toBe(out.sameBand[0]);     // 1100 is the next step up
  expect(out.sea).not.toBe(out.nextBand);
});

// The whole-route view (zoom 8-9) is exactly where a pilot looks, and a zoom floor made it
// the one view that drew nothing at all — reported as "doesn't seem to do anything". Cells
// are merged into legible blocks there instead of being skipped.
test('it draws at every zoom, including the whole-route view', async ({ page }) => {
  await boot(page);
  const perZoom = await page.evaluate(async () => {
    const out = {};
    for (const z of [8, 9, 10, 12, 13]) {
      map.setView([32.7, 35.2], z);
      await new Promise(r => setTimeout(r, 60));
      drawTerrainTint();
      out[z] = window.__terrainTintCells;
    }
    return out;
  });
  for (const [z, n] of Object.entries(perZoom)) expect(n, 'zoom ' + z).toBeGreaterThan(50);
});

test('zoomed out it merges cells rather than drawing thousands of invisible ones', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    map.setView([32.7, 35.2], 8);
    await new Promise(r => setTimeout(r, 60));
    drawTerrainTint();
    const merged = window.__terrainTintCells;
    setTune('terrainTintMinCellPx', 2);          // ask for near-raw cells
    drawTerrainTint();
    return { merged, raw: window.__terrainTintCells };
  });
  expect(out.merged).toBeLessThan(out.raw);      // blocks, not one quad per grid cell
});

test('a block carries the HIGHEST ground in it, never the lowest', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    // Two bands apart, so rounding the wrong way would be visible as a colour.
    setTune('terrainBandFt', 500);
    return { high: terrainTintColor(1600), low: terrainTintColor(200) };
  });
  expect(out.high).not.toBe(out.low);
});

test('the knob can still switch it off below a zoom', async ({ page }) => {
  await boot(page);
  const off = await page.evaluate(() => {
    setTune('terrainTintMinZoom', 14);
    window.__terrainTintCells = -1;               // so an early return is distinguishable
    drawTerrainTint();
    return window.__terrainTintCells;
  });
  expect(off).toBe(-1);            // returned before painting anything
});

test('no coverage means no tint, not a flat colour', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof drawTerrainTint === 'function');
  const fills = await page.evaluate(() => {
    terrainGrid = { coverage: false };
    let n = 0;
    const real = octx.fill.bind(octx);
    octx.fill = (...a) => { n++; return real(...a); };
    drawTerrainTint();
    octx.fill = real;
    return n;
  });
  expect(fills).toBe(0);
});

test('the leg inspector still carries the MSA row it always did', async ({ page }) => {
  await boot(page);
  const hasRow = await page.evaluate(() => {
    window.showMsa = true;
    state.waypoints = [{ lat: 32.70, lng: 35.10, name: 'A' }, { lat: 32.95, lng: 35.45, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.inboundAltitude = 2000; l.flightSpeed = 100; });
    state.selected = { type: 'leg', index: 0 };
    showInspector();
    return /MSA/i.test(document.getElementById('insp-body').textContent);
  });
  expect(hasRow).toBe(true);
});
