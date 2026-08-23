// @ts-check
// The card must end where it started whatever the phone's size and however fast the menu is
// worked: the toolbar collapses over several frames, and an attempt to put the legend back
// that lands mid-animation reads a bar that is still tall. Sizes chosen so the toolbar wraps
// differently across them -- that difference is what made an earlier fix pass on a laptop
// and fail on CI.
const { test, expect } = require('./_setup');
for (const [w, h] of [[390, 780], [360, 720], [412, 915], [320, 640], [430, 932]]) {
  test(`the legend ends where it started at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.addInitScript(() => {
      localStorage.setItem('navaid.legendCollapsed', '0');
      localStorage.setItem('navaid.legendPos.en', JSON.stringify({ x: 12, y: 300 }));
    });
    await page.goto('?lang=en&nogist');
    await page.waitForSelector('#boot-loading', { state: 'detached', timeout: 15000 });
    const y = () => page.evaluate(() => Math.round(document.getElementById('map-legend').getBoundingClientRect().y));
    const start = await y();
    for (let i = 0; i < 3; i++) {
      await page.locator('#toolbar-toggle').click();
      await page.waitForTimeout(400 + i * 150);
      await page.locator('#toolbar-toggle').click();
      await page.waitForTimeout(400 + i * 150);
    }
    await expect.poll(y, { timeout: 6000 }).toBe(start);
  });
}
