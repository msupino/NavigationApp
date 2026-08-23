// @ts-check
// The legend must not walk whatever the chrome's geometry. CI renders a taller collapsed
// toolbar than a laptop does, which is what made an earlier version of this fix look right
// locally and wrong there: the card could not reach its old spot, so it stayed where the
// shove left it -- and if that had been persisted, the next trip would move it again.
const { test, expect } = require('./_setup');

test('a taller collapsed toolbar still leaves the legend where it was', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.addInitScript(() => {
    localStorage.setItem('navaid.legendCollapsed', '0');
    localStorage.setItem('navaid.legendPos.en', JSON.stringify({ x: 12, y: 300 }));
  });
  await page.goto('?lang=en&nogist');
  await page.waitForSelector('#boot-loading', { state: 'detached', timeout: 15000 });
  await page.evaluate(() => {
    document.getElementById('toolbar').style.minHeight = '240px';   // a fatter collapsed bar
    window.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(600);
  const at = () => page.evaluate(() => {
    const r = document.getElementById('map-legend').getBoundingClientRect();
    return { y: Math.round(r.y), stored: JSON.parse(localStorage.getItem('navaid.legendPos.en')) };
  });
  const start = await at();
  for (let i = 0; i < 3; i++) {
    await page.locator('#toolbar-toggle').click();
    await page.waitForTimeout(400);
    await page.locator('#toolbar-toggle').click();
    await page.waitForTimeout(600);
  }
  const end = await at();
  expect(end.y).toBe(start.y);              // no walking, whatever the geometry
  expect(end.stored).toEqual(start.stored); // and the stored spot is untouched
});
