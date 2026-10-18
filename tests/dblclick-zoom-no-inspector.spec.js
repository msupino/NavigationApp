// @ts-check
// Reported: "double click on map to zoom on waypoint should not open inspector". A double-click
// zooms the chart; the panel its first click opened goes back to what was showing before.
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 1300, height: 850 } });

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function' && typeof showInspector === 'function');
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'A' }, { lat: 32.40, lng: 34.95, name: 'B' }];
    syncLegs(); map.setView([32.30, 34.90], 10, { animate: false }); draw();
  });
}
const at = (page, ll) => page.evaluate((ll) => { const r = map.getContainer().getBoundingClientRect();
  const p = map.latLngToContainerPoint(ll); return { x: r.left + p.x, y: r.top + p.y }; }, ll);

test('double-click on a route waypoint zooms, and opens no inspector', async ({ page }) => {
  await boot(page);
  const z0 = await page.evaluate(() => map.getZoom());
  const p = await at(page, [32.40, 34.95]);
  await page.mouse.dblclick(p.x, p.y);
  await expect.poll(() => page.evaluate(() => map.getZoom())).toBeGreaterThan(z0);
  expect(await page.evaluate(() => state.selected)).toBeNull();
  await expect(page.locator('#inspector')).toHaveClass(/hidden/);
});

test('with a panel already open, a double-click elsewhere leaves that panel', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { state.selected = { type: 'wp', index: 0 }; showInspector(); });
  const p = await at(page, [32.40, 34.95]);
  await page.mouse.dblclick(p.x, p.y);
  expect(await page.evaluate(() => state.selected)).toEqual({ type: 'wp', index: 0 });
});

test('a single click still opens it', async ({ page }) => {
  await boot(page);
  const p = await at(page, [32.40, 34.95]);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => state.selected)).toEqual({ type: 'wp', index: 1 });
});
