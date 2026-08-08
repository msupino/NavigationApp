// @ts-check
// Searching a waypoint flies the map there and leaves nothing marked, so the pilot lands on
// a new view and has to work out which of several nearby symbols was the hit. The result now
// gets a ring for a few seconds -- an answer to "where is it", not a change to the route.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try { for (const s of ['build', 'view', 'display']) localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' && typeof flashMapPoint === 'function');
}

const search = async (page, text) => {
  await page.fill('#wp-search', text);
  await page.waitForSelector('#wp-search-results:not(.hidden)');
  await page.locator('#wp-search-results > *').first().click();
};

test('picking a search result rings it', async ({ page }) => {
  await boot(page);
  await search(page, 'LLHZ');
  const ring = page.locator('.search-flash');
  await expect(ring).toHaveCount(1);
  // ...and the map went there, which is the pre-existing behaviour this must not disturb.
  const c = await page.evaluate(() => map.getCenter());
  expect(Math.abs(c.lat - 32.18)).toBeLessThan(0.2);
});

test('the ring disappears on its own', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { window.__tuneOverride = { searchFlashMs: 600 }; });
  await page.evaluate(() => flashMapPoint(32.18, 34.83));
  await expect(page.locator('.search-flash')).toHaveCount(1);
  // It is not a marker: it must clean itself up, or a session accumulates rings over every
  // place the pilot has ever looked.
  await expect(page.locator('.search-flash')).toHaveCount(0, { timeout: 8000 });
});

test('a second search replaces the first ring rather than stacking', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    flashMapPoint(32.18, 34.83);
    flashMapPoint(32.40, 35.05);
    flashMapPoint(31.90, 34.75);
  });
  await expect(page.locator('.search-flash')).toHaveCount(1);
});

test('the ring never swallows a click meant for the map', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => flashMapPoint(32.18, 34.83));
  const hits = await page.evaluate(() => {
    const el = document.querySelector('.search-flash');
    const r = el.getBoundingClientRect();
    const under = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { isFlash: !!(under && under.closest('.search-flash')),
      paneEvents: getComputedStyle(map.getPane('searchflash')).pointerEvents };
  });
  // Its pane is pointer-events:none, so tapping where the ring is still adds a waypoint.
  expect(hits.isFlash).toBe(false);
  expect(hits.paneEvents).toBe('none');
});

test('setting the duration to zero turns it off', async ({ page }) => {
  await boot(page);
  const n = await page.evaluate(() => {
    const real = window.tune;
    window.tune = (k) => (k === 'searchFlashMs' ? 0 : real(k));
    flashMapPoint(32.18, 34.83);
    window.tune = real;
    return document.querySelectorAll('.search-flash').length;
  });
  expect(n).toBe(0);
});

test('the flash is tunable, and listed in the Search group', () => {
  const fs = require('fs');
  const path = require('path');
  const core = fs.readFileSync(path.join(__dirname, '..', 'docs', 'app', 'core.js'), 'utf8');
  // Anything with a number a pilot might want to change belongs in the tune menu.
  expect(core).toMatch(/searchFlashMs:\s*\{ value: \d+/);
  expect(core).toMatch(/searchFlashRadiusPx:\s*\{ value: \d+/);
  const group = core.slice(core.indexOf("{ name: 'Search'"), core.indexOf("{ name: 'Search'") + 400);
  expect(group).toContain('searchFlashMs');
  expect(group).toContain('searchFlashRadiusPx');
});
