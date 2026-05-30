// @ts-check
// Coverage for legPairTitle() — the leg-inspector heading built from the two
// endpoint waypoint labels. Named endpoints join with the direction arrow;
// unnamed ones fall back to the "WP N" sequence label; a missing endpoint
// falls back to the legacy "Leg N" title.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof legPairTitle === 'function' && typeof state !== 'undefined');
}

async function setRoute(page, names) {
  await page.evaluate(ns => {
    state.waypoints = ns.map((name, i) => ({ lat: 32 + i * 0.1, lng: 34.9, name }));
    syncLegs();
  }, names);
}

test.describe('legPairTitle()', () => {
  test('named endpoints join with the direction arrow', async ({ page }) => {
    await boot(page);
    await setRoute(page, ['TLV', 'NETANYA']);
    expect(await page.evaluate(() => legPairTitle(0))).toBe('TLV → NETANYA');
  });

  test('unnamed endpoints fall back to WP sequence labels', async ({ page }) => {
    await boot(page);
    await setRoute(page, ['', '']);
    expect(await page.evaluate(() => legPairTitle(0))).toBe('WP 1 → WP 2');
  });

  test('mixed named / unnamed endpoints', async ({ page }) => {
    await boot(page);
    await setRoute(page, ['TLV', '']);
    expect(await page.evaluate(() => legPairTitle(0))).toBe('TLV → WP 2');
  });

  test('whitespace-only name counts as unnamed', async ({ page }) => {
    await boot(page);
    await setRoute(page, ['   ', 'NETANYA']);
    expect(await page.evaluate(() => legPairTitle(0))).toBe('WP 1 → NETANYA');
  });

  test('missing endpoint falls back to the legacy "Leg N" title', async ({ page }) => {
    await boot(page);
    await setRoute(page, ['TLV', 'NETANYA']);   // only 1 leg (index 0)
    expect(await page.evaluate(() => legPairTitle(5))).toBe('Leg 6');
  });
});
