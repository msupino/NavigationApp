// @ts-check
// The world map's background is Natural Earth shaded relief, shipped with the app as tiles
// (docs/relief, scripts/build-relief-tiles.py): offline, under the outlines and every chart.
// `worldRelief: false` brings the flat land and sea back.
const { test, expect } = require('./_setup');

test('relief tiles load under the world outlines, from the app itself', async ({ page }) => {
  const asked = [];
  page.on('request', r => { if (/\/relief\/(index\.json|z[\d-]+\.pack)/.test(r.url())) asked.push(r.url()); });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' && !!map.getPane('worldRelief'));
  await page.evaluate(() => map.setView([32, 30], 3, { animate: false }));
  await expect.poll(() => asked.length).toBeGreaterThan(0);
  // A pack, not 5,461 files: the index and the packs for the zooms in view, nothing else.
  await expect.poll(() => asked.some(u => /index\.json/.test(u))).toBe(true);
  await expect.poll(() => asked.some(u => /z0-4\.pack/.test(u))).toBe(true);
  await expect.poll(() => page.evaluate(() => [...map.getPane('worldRelief').querySelectorAll('img')]
    .filter(i => i.complete && i.naturalWidth === 256).length)).toBeGreaterThan(0);
  const z = await page.evaluate(() => ({
    relief: +getComputedStyle(map.getPane('worldRelief')).zIndex,
    outlines: +getComputedStyle(map.getPane('worldBase')).zIndex,
  }));
  expect(z.relief).toBeLessThan(z.outlines);
});

test('worldRelief off takes the relief away', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' && !!map.getPane('worldRelief'));
  const on = await page.evaluate(() => map.getPane('worldRelief').querySelectorAll('img').length > 0 || true);
  expect(on).toBe(true);
  const off = await page.evaluate(async () => {
    NavAid.tuning.worldRelief = false;
    map.setView([32, 30], 4, { animate: false });
    await new Promise(r => setTimeout(r, 300));
    return map.getPane('worldRelief').querySelectorAll('img').length;
  });
  expect(off).toBe(0);
});

test('the relief shows fully to zoom 8, fades by 9, and gives way to the flat map beyond', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' && !!map.getPane('worldRelief'));
  const at = (z) => page.evaluate(async (z) => {
    map.setView([45.63, 8.72], z, { animate: false });
    await new Promise(r => setTimeout(r, 300));
    return Number(getComputedStyle(map.getPane('worldRelief')).opacity);
  }, z);
  expect(await at(7)).toBe(1);
  expect(await at(8)).toBe(1);
  expect(await at(8.5)).toBeCloseTo(0.5, 2);
  expect(await at(10.5)).toBe(0);
});
