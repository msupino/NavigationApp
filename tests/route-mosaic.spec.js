// @ts-check
// Charts → Satellite mosaic: a grid of static satellite previews, one per route
// waypoint, each labelled and clickable to open the full satellite modal.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.charts', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof showRouteMosaicModal === 'function');
}

test('mosaic shows one labelled satellite preview per waypoint', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.18, lng: 34.83, name: 'LLHZ' },
      { lat: 32.55, lng: 34.92, name: 'HADERA' },
      { lat: 32.81, lng: 35.04, name: 'LLHA' },
    ];
    if (typeof syncLegs === 'function') syncLegs();
  });
  await page.evaluate(() => document.getElementById('mosaic-btn').click());
  const modal = page.locator('.route-mosaic-modal');
  await expect(modal).toBeVisible();
  // One cell per waypoint, each with a label + a satellite snippet (3×3 tiles).
  await expect(modal.locator('.route-mosaic-cell')).toHaveCount(3);
  await expect(modal).toContainText('LLHZ');
  await expect(modal).toContainText('HADERA');
  await expect(modal.locator('.route-mosaic-cell .satellite-snippet')).toHaveCount(3);
  await expect(modal.locator('.route-mosaic-cell').first()
    .locator('.satellite-snippet img')).toHaveCount(9);
});

test('clicking a mosaic cell opens the satellite view for that waypoint', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }];
    if (typeof syncLegs === 'function') syncLegs();
  });
  await page.evaluate(() => document.getElementById('mosaic-btn').click());
  await page.locator('.route-mosaic-cell').first().click();
  await expect(page.locator('.satellite-preview-modal')).toBeVisible();
});

test('mosaic with no waypoints shows an empty message', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { state.waypoints = []; });
  await page.evaluate(() => document.getElementById('mosaic-btn').click());
  const modal = page.locator('.route-mosaic-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.route-mosaic-empty')).toBeVisible();
  await expect(modal.locator('.route-mosaic-cell')).toHaveCount(0);
});
