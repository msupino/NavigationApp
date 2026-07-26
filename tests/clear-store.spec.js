// @ts-check
// "Clear store" must wipe everything — including the route on the map. The
// reload it triggers used to re-persist the in-memory route via beforeunload,
// leaving the route behind.
const { test, expect } = require('./_setup');

test('clear store removes the route from the map (no re-persist on reload)', async ({ page }) => {
  // #clear-store now lives with the other data-management controls, not in Edit.
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.export', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof flushPersist === 'function');

  // Build a route + save it to storage.
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.0, lng: 34.8, name: 'A' },
      { lat: 32.2, lng: 35.0, name: 'B' },
    ];
    syncLegs();
    flushPersist();
  });
  expect(await page.evaluate(() => localStorage.getItem('navaid.route'))).toBeTruthy();

  // Accept the confirm, click Clear store → it reloads.
  page.on('dialog', d => d.accept());
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load' }),
    page.locator('#clear-store').click(),
  ]);

  await page.waitForFunction(() => typeof state !== 'undefined');
  // Route gone from memory and storage.
  expect(await page.evaluate(() => state.waypoints.length)).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('navaid.route'))).toBeNull();
});
