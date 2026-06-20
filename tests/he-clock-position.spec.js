// @ts-check
// The Zulu clock defaults to the top-LEFT corner in Hebrew (RTL), where the
// menu bar occupies the top-right. On small screens (menu bar moves top-left)
// it drops below the bar. English keeps the Leaflet top-right placement.
const { test, expect } = require('./_setup');

async function clockBox(page, lang, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto('?lang=' + lang);
  await page.waitForFunction(() => document.getElementById('zulu-clock'));
  await page.waitForTimeout(200);
  return page.evaluate(() => {
    const c = document.getElementById('zulu-clock').getBoundingClientRect();
    return { left: c.left, fromRight: window.innerWidth - c.right, top: c.top };
  });
}

test('English keeps the clock top-right (desktop)', async ({ page }) => {
  const b = await clockBox(page, 'en', 1280, 800);
  expect(b.fromRight).toBeLessThan(40);
  expect(b.left).toBeGreaterThan(400);
});

test('Hebrew defaults the clock to the left, dropped down like English (desktop)', async ({ page }) => {
  const en = await clockBox(page, 'en', 1280, 800);
  const he = await clockBox(page, 'he', 1280, 800);
  expect(he.left).toBeLessThan(40);              // left side (vs English right)
  expect(he.top).toBeGreaterThan(40);           // dropped below the top band
  expect(Math.abs(he.top - en.top)).toBeLessThan(4);  // same vertical drop as English
});

test('Hebrew clock stays top-left but below the menu bar on small screens', async ({ page }) => {
  const b = await clockBox(page, 'he', 390, 780);
  expect(b.left).toBeLessThan(40);            // still left
  expect(b.top).toBeGreaterThan(40);          // pushed below the top-left menu bar
});
