// @ts-check
// On phones the inspector is a near-full-screen panel; auto-opening it after
// every add-mode tap blanketed the map. Adding a waypoint on a narrow viewport
// must NOT open the inspector (the waypoint is still selected; tap to edit).
// Desktop keeps the side-panel behaviour.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof map !== 'undefined' && typeof showInspector === 'function');
}
async function addWaypointViaClick(page) {
  await page.evaluate(() => { state.mode = 'add'; });
  await page.evaluate(() => { map.fire('click', { latlng: L.latLng(32.1, 34.9) }); });
}

test('mobile viewport: adding a waypoint keeps the inspector hidden', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await boot(page);
  await addWaypointViaClick(page);
  expect(await page.evaluate(() => state.waypoints.length)).toBe(1);
  expect(await page.evaluate(() => state.selected && state.selected.type)).toBe('wp');
  await expect(page.locator('#inspector')).toHaveClass(/hidden/);
});

test('desktop viewport: adding a waypoint opens the inspector', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await boot(page);
  await addWaypointViaClick(page);
  expect(await page.evaluate(() => state.waypoints.length)).toBe(1);
  await expect(page.locator('#inspector')).not.toHaveClass(/hidden/);
});
