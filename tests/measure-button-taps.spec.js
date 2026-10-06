// @ts-check
// With Measure on, pressing a map button must not drop a measure point. The route lock
// redraws its icon as it is pressed; the click lost its target and the browser gave it to the
// map, so the lock put a measure point where it sits.
const { test, expect } = require('./_setup');
test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test('map buttons do not measure; the map right after them still does', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof measureToggle === 'function' && NavAid.disclaimerDone);
  // The ruler measures from a position: a simulated aircraft, not locking the route.
  await page.evaluate(() => { simOn = true; simAircraft = { lat: 32.05, lng: 34.95, alt: 300, hdg: 0, ias: 0 }; window.editUnlockOverride = true; measureToggle(true); });
  await page.locator('#edit-lock').tap();
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => !!window.measure.to)).toBe(false);
  // The next tap on the chart itself measures as usual.
  const box = await page.locator('#map').boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => page.evaluate(() => !!window.measure.to)).toBe(true);
});
