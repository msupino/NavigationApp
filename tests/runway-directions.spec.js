// @ts-check
// Inspector shows the runway directions for a waypoint that matches a
// known airfield (issue #231).
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_rwy_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_rwy_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof state !== 'undefined' &&
    typeof showInspector === 'function' &&
    Array.isArray(window.airfields) && window.airfields.length > 0);
}

test.describe('#231 — runway directions in inspector', () => {
  test('LLHZ waypoint inspector renders the published runway 10/28', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18060, lng: 34.83470, name: 'LLHZ' }];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    const chips = await page.locator('.runway-chip').allTextContents();
    expect(chips).toContain('10/28');
  });

  test('LLBG waypoint inspector renders multiple runways', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.00, lng: 34.88, name: 'LLBG' }];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    const chips = await page.locator('.runway-chip').allTextContents();
    expect(chips.length).toBeGreaterThanOrEqual(2);
  });

  test('non-airfield waypoint inspector has no runway chips', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.21861, lng: 34.88250, name: 'BAZRA' }];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    await expect(page.locator('.runway-chip')).toHaveCount(0);
  });

  test('renamed label at same ARP keeps runway chips (coord match)', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18060, lng: 34.83470, name: 'LLHZ1' }];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    const chips = await page.locator('.runway-chip').allTextContents();
    expect(chips).toContain('10/28');
  });
});
