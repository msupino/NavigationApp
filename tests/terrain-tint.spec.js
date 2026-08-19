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

test('it stays off the chart when zoomed out, where it would be a brown wash', async ({ page }) => {
  await boot(page);                                    // boots at zoom 10
  // The map's own minimum zoom is 8, so "zoom out until it disappears" cannot be written as
  // a setView; raise the threshold above the current zoom instead, which is the same test of
  // the same guard.
  const off = await page.evaluate(() => {
    setTune('terrainTintMinZoom', 12);
    let fills = 0;
    const real = octx.fill.bind(octx);
    octx.fill = (...a) => { fills++; return real(...a); };
    drawTerrainTint();
    octx.fill = real;
    return fills;
  });
  expect(off).toBe(0);
  // ...and the shipped threshold is above the map's minimum, so the whole-country view is
  // never painted: at zoom 8 the grid is ~15 000 cells and hides the chart underneath.
  const shipped = await page.evaluate(() => NavAid.tuningDefaults.terrainTintMinZoom.value);
  expect(shipped).toBeGreaterThan(8);
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
