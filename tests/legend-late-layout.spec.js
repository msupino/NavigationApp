// @ts-check
// The runner's problem, forced: the toolbar collapses over several frames, and on a loaded
// machine every reconcile that fires during them reads a bar that is still tall. Nothing
// changes afterwards, so no further resize event arrives -- the card can only get home if it
// asks for another go itself. Hogging the main thread reproduces that here.
const { test, expect } = require('./_setup');

test('the legend still gets home when the layout settles late', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.addInitScript(() => {
    localStorage.setItem('navaid.legendCollapsed', '0');
    localStorage.setItem('navaid.legendPos.en', JSON.stringify({ x: 12, y: 300 }));
  });
  await page.goto('?lang=en&nogist');
  await page.waitForSelector('#boot-loading', { state: 'detached', timeout: 15000 });
  const y = () => page.evaluate(() => Math.round(document.getElementById('map-legend').getBoundingClientRect().y));
  const start = await y();
  await page.locator('#toolbar-toggle').click();
  await expect.poll(y, { timeout: 5000 }).not.toBe(start);
  // Close it and immediately hog the main thread, so every early reconcile reads a stale
  // layout and only a self-scheduled retry can finish the job.
  await page.locator('#toolbar-toggle').click();
  await page.evaluate(() => { const end = performance.now() + 400; while (performance.now() < end); });
  await expect.poll(y, { timeout: 8000 }).toBe(start);
});
