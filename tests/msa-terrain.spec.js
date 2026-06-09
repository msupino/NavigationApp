// #673 — minimum safe altitude / terrain clearance. Engine + leg-inspector
// MSA row (gated on terrain coverage; flagged when planned alt is below MSA).
const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof showInspector === 'function' && typeof legMsaFt === 'function');
}

// A 1-cell grid of 1000 m (~3281 ft) over central Israel → MSA = ceil((3281+
// 1000)/100)*100 = 4300 ft.
const GRID = { coverage: true, units: 'm', south: 31, west: 34, north: 33, east: 36,
  rows: 1, cols: 1, data: [[1000]] };

async function setup(page, alt) {
  await page.evaluate(({ grid, a }) => {
    terrainGrid = grid;                                   // force coverage
    state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.3, lng: 35.0, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs[0].inboundAltitude = a; state.legs[0].outboundAltitude = a;
    state.selected = { type: 'leg', index: 0 }; showInspector();
  }, { grid: GRID, a: alt });
}

test('legMsaFt = terrain max + 1000 ft buffer, rounded up', async ({ page }) => {
  await boot(page);
  const msa = await page.evaluate(({ grid }) => {
    terrainGrid = grid;
    state.waypoints = [{ lat: 32.0, lng: 34.8 }, { lat: 32.3, lng: 35.0 }];
    state.legs = []; syncLegs();
    return legMsaFt(0);
  }, { grid: GRID });
  expect(msa).toBe(4300);
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
