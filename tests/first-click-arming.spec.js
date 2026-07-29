// @ts-check
// A plain map click arms add mode only for a user who is being TOLD to click — i.e. while
// the one-time empty-route hint is on screen. Keying it off "the route is empty" alone
// dropped a waypoint on every returning user who cleared the map and clicked to look at
// something.
const { test, expect } = require('./_setup');

async function fresh(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof setMode === 'function');
  await page.evaluate(() => { state.waypoints = []; state.legs = []; state.notes = [];
    syncLegs(); state.mode = null; draw(); });
}

// A returning user: the hint has been seen, so it is not rendered any more.
async function returning(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.hintEmptyRoute', '1'); } catch (e) { /* */ }
  });
  await fresh(page);
}

const clickMap = (page, lat, lng) => page.evaluate(([lat, lng]) =>
  map.fire('click', { latlng: L.latLng(lat, lng) }), [lat, lng]);

test('a new user: the hint is up, and the first click starts the route', async ({ page }) => {
  await fresh(page);
  await expect(page.locator('#empty-route-hint')).toBeVisible();
  await clickMap(page, 32.18, 34.83);
  await page.waitForTimeout(80);
  const r = await page.evaluate(() => ({ wps: state.waypoints.length, mode: state.mode }));
  expect(r.wps).toBe(1);
  expect(r.mode).toBe('add');            // armed, so the next click keeps adding
  await clickMap(page, 32.44, 34.90);
  await page.waitForTimeout(80);
  expect(await page.evaluate(() => state.waypoints.length)).toBe(2);
});

test('a returning user: a click on empty map does NOTHING', async ({ page }) => {
  await returning(page);
  await expect(page.locator('#empty-route-hint')).toHaveCount(0);
  await clickMap(page, 32.18, 34.83);
  await page.waitForTimeout(80);
  const r = await page.evaluate(() => ({ wps: state.waypoints.length, mode: state.mode }));
  expect(r.wps).toBe(0);                 // the reported bug: this used to be 1
  expect(r.mode).toBeNull();             // and add mode used to arm itself
});

test('a returning user can still start a route deliberately', async ({ page }) => {
  await returning(page);
  await page.evaluate(() => setMode('add'));
  await clickMap(page, 32.18, 34.83);
  await page.waitForTimeout(80);
  const r = await page.evaluate(() => ({ wps: state.waypoints.length, mode: state.mode,
    chip: !!document.getElementById('mode-chip') }));
  expect(r.wps).toBe(1);
  expect(r.mode).toBe('add');
  expect(r.chip).toBe(true);             // and the chip says how to stop
});

test('clearing the map later does not re-arm clicking', async ({ page }) => {
  // The hint never returns after Clear map, so neither should the auto-arm.
  await fresh(page);
  await clickMap(page, 32.18, 34.83);
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    setMode(null);
    state.waypoints = []; state.legs = []; syncLegs(); draw();
    refreshEmptyRouteHint();
  });
  await expect(page.locator('#empty-route-hint')).toHaveCount(0);
  await clickMap(page, 32.30, 34.88);
  await page.waitForTimeout(80);
  const r = await page.evaluate(() => ({ wps: state.waypoints.length, mode: state.mode }));
  expect(r.wps).toBe(0);
  expect(r.mode).toBeNull();
});

test('once a route exists, a plain click still never adds', async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 34.86, name: 'A' }, { lat: 32.3, lng: 34.9, name: 'B' }];
    state.legs = []; syncLegs(); state.mode = null; draw();
  });
  await clickMap(page, 32.5, 35.0);
  await page.waitForTimeout(80);
  expect(await page.evaluate(() => state.waypoints.length)).toBe(2);
});
