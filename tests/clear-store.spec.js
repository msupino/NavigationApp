// @ts-check
// "Clear store" must wipe everything — including the route on the map. The
// reload it triggers used to re-persist the in-memory route via beforeunload,
// leaving the route behind.
const { test, expect, answerAppDialogs } = require('./_setup');

test('clear store removes the route from the map (no re-persist on reload)', async ({ page }) => {
  // The wipe is the last-resort row in the Settings > Storage window now.
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.settings', '1'); } catch (e) {} });
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

  // Accept the confirm, open the Storage window and click its last-resort wipe → it reloads.
  await answerAppDialogs(page, true);
  await page.evaluate(() => showStorageModal());
  await page.waitForSelector('.storage-wipe-btn');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'load' }),
    page.locator('.storage-wipe-btn').click(),
  ]);

  await page.waitForFunction(() => typeof state !== 'undefined');
  // Route gone from memory and storage.
  expect(await page.evaluate(() => state.waypoints.length)).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('navaid.route'))).toBeNull();
});
