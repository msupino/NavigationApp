// @ts-check
// Saving a route stores the map orientation (leaflet-rotate bearing); loading
// it restores that orientation. North-up (0) is omitted to avoid schema churn.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof map !== 'undefined' &&
    typeof serializeRoute === 'function' && typeof applyRouteData === 'function' &&
    map.setBearing && map.getBearing);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.85, name: 'A' }, { lat: 32.2, lng: 35.05, name: 'B' }];
    syncLegs(); map.setView([32.1, 34.95], 11); draw();
  });
}

test('serializeRoute stores the map bearing; 0 (north-up) is omitted', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    map.setBearing(0);
    const north = serializeRoute();
    map.setBearing(45);
    const rotated = serializeRoute();
    return { hasNorth: Object.prototype.hasOwnProperty.call(north, 'bearing'), bearing: rotated.bearing };
  });
  expect(r.hasNorth).toBe(false);      // north-up omitted
  expect(r.bearing).toBe(45);
});

test('applyRouteData restores the saved map orientation', async ({ page }) => {
  await boot(page);
  const b = await page.evaluate(() => {
    map.setBearing(0);
    const data = { waypoints: [{ lat: 32.0, lng: 34.85, name: 'A' }, { lat: 32.2, lng: 35.05, name: 'B' }],
      legs: [{ flightSpeed: 90 }], notes: [], bearing: 120 };
    applyRouteData(data);
    return Math.round(map.getBearing());
  });
  expect(((b % 360) + 360) % 360).toBe(120);
});

test('a route with no bearing loads north-up', async ({ page }) => {
  await boot(page);
  const b = await page.evaluate(() => {
    map.setBearing(90);   // pre-existing rotation
    applyRouteData({ waypoints: [{ lat: 32.0, lng: 34.85, name: 'A' }, { lat: 32.2, lng: 35.05, name: 'B' }],
      legs: [{ flightSpeed: 90 }], notes: [] });
    return Math.round(map.getBearing());
  });
  expect(((b % 360) + 360) % 360).toBe(0);   // absent bearing → north-up
});
