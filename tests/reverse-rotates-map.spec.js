// @ts-check
// Reversing the route turns the chart round with it. What was ahead of the aircraft is now
// behind it, so a map left facing the old way is showing the flight that is no longer
// planned — and the pilot had to rotate it by hand after every reversal.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function' && document.getElementById('reverse'));
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.80, name: 'A' },
      { lat: 32.30, lng: 35.10, name: 'B' },
    ];
    syncLegs(); draw();
  });
}

const bearing = (page) => page.evaluate(() => Math.round(mapBearing()));
const reverse = (page) => page.evaluate(() => document.getElementById('reverse').click());

test('reversing turns the map 180°', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => map.setBearing(20));
  await reverse(page);
  expect(await bearing(page)).toBe(200);
});

test('...and reversing back returns the original bearing', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => map.setBearing(20));
  await reverse(page);
  await reverse(page);
  expect(await bearing(page)).toBe(20);       // 20 -> 200 -> 20, not 380
});

test('from north-up it lands on 180, not -180', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => map.setBearing(0));
  await reverse(page);
  expect(await bearing(page)).toBe(180);
});

test('a route too short to reverse leaves the bearing alone', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { state.waypoints = [{ lat: 32, lng: 34.8, name: 'A' }]; syncLegs(); map.setBearing(45); });
  await reverse(page);
  expect(await bearing(page)).toBe(45);
});

test('the knob puts the old behaviour back', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { setTune('reverseRotatesMap', false); map.setBearing(20); });
  await reverse(page);
  expect(await bearing(page)).toBe(20);
});

// Heading-up means the bearing belongs to the aircraft, not to the plan: the next fix would
// undo a manual turn anyway, so reversing must not fight it.
test('heading-up mode is left to drive the bearing itself', async ({ page }) => {
  await boot(page);
  const after = await page.evaluate(() => {
    map.setBearing(30);
    headingUpOn = true;                      // as the orientation control sets it
    document.getElementById('reverse').click();
    headingUpOn = false;
    return Math.round(mapBearing());
  });
  expect(after).toBe(30);
});
