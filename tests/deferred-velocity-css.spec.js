// @ts-check
// The wind layer's stylesheet does not hold up the first paint (PageSpeed listed it as
// render-blocking): it loads as media="print" and applies itself on load. Guarded: it is
// still applied by the time the app is up, and it keeps its integrity hash.
const { test, expect } = require('./_setup');

test('the leaflet-velocity stylesheet is non-blocking and applied once loaded', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  const link = page.locator('link[href*="leaflet-velocity"][rel="stylesheet"]');
  await expect(link).toHaveAttribute('integrity', /^sha384-/);
  await expect(link).toHaveAttribute('onload', "this.media='all'");
  await expect.poll(() => link.evaluate((l) => l.media), { timeout: 10000 }).toBe('all');
  // and its rules are live: the overlay class gets its z-index
  const z = await page.evaluate(() => {
    const d = document.createElement('div'); d.className = 'velocity-overlay';
    document.body.appendChild(d); const v = getComputedStyle(d).zIndex; d.remove(); return v;
  });
  expect(z).toBe('1');
});
