// #673 — minimum safe altitude / terrain clearance. Engine + leg-inspector
// MSA row (gated on terrain coverage; flagged when planned alt is below MSA).
const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof showInspector === 'function' && typeof legMsaFt === 'function');
}

// A 1-cell grid of 1000 m (~3281 ft) over central Israel → MSA = round((3281+
// 1000)/100)*100 = 4300 ft.
const GRID = { coverage: true, units: 'm', south: 31, west: 34, north: 33, east: 36,
  rows: 1, cols: 1, data: [[1000]] };

async function setup(page, alt) {
  await page.evaluate(({ grid, a }) => {
    terrainGrid = grid;                                   // force coverage
    window.showMsa = true;                                // opt-in toggle (#673)
    state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.3, lng: 35.0, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs[0].inboundAltitude = a; state.legs[0].outboundAltitude = a;
    state.selected = { type: 'leg', index: 0 }; showInspector();
  }, { grid: GRID, a: alt });
}

test('legMsaFt = terrain max + 1000 ft buffer, rounded to nearest 100', async ({ page }) => {
  await boot(page);
  const msa = await page.evaluate(({ grid }) => {
    terrainGrid = grid;
    state.waypoints = [{ lat: 32.0, lng: 34.8 }, { lat: 32.3, lng: 35.0 }];
    state.legs = []; syncLegs();
    return legMsaFt(0);
  }, { grid: GRID });
  expect(msa).toBe(4300);
});

// Softening (#705 follow-up): rounding to NEAREST 100 — terrain of ~153 m
// (501 ft) + 1000 buffer = 1501 → 1500, not 1600 as the old ceil would give.
test('legMsaFt rounds to nearest 100, not up (soft MSA)', async ({ page }) => {
  await boot(page);
  const msa = await page.evaluate(() => {
    terrainGrid = { coverage: true, units: 'ft', south: 31, west: 34,
      north: 33, east: 36, rows: 1, cols: 1, data: [[501]] };
    state.waypoints = [{ lat: 32.0, lng: 34.8 }, { lat: 32.3, lng: 35.0 }];
    state.legs = []; syncLegs();
    return legMsaFt(0);
  });
  expect(msa).toBe(1500);          // 501 + 1000 = 1501 → nearest 100 = 1500
});

test('leg inspector shows MSA and flags an altitude below it', async ({ page }) => {
  await boot(page);
  await setup(page, 2000);                                // below 4300
  const row = page.locator('#insp-body .msa-low');
  await expect(row).toBeVisible();
  await expect(row).toContainText('4300');
});

test('MSA row not flagged when planned altitude clears it', async ({ page }) => {
  await boot(page);
  await setup(page, 6000);                                // above 4300
  await expect(page.locator('#insp-body .row', { hasText: 'MSA' })).toContainText('4300');
  await expect(page.locator('#insp-body .msa-low')).toHaveCount(0);
});

test('no MSA row without terrain coverage', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    terrainGrid = { coverage: false };
    state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.3, lng: 35.0, name: 'B' }];
    state.legs = []; syncLegs();
    state.selected = { type: 'leg', index: 0 }; showInspector();
  });
  await expect(page.locator('#insp-body .row', { hasText: 'MSA' })).toHaveCount(0);
});
