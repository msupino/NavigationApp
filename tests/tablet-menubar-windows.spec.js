// @ts-check
// Reported: on an iPad with the desktop layout (gist featureTabletDesktop), "some charts are hidden
// by the top menu". Touch screens anchor windows to the top of their space so they do not jump while
// typing; with the menubar that space was the top of the screen, under the bar -- which on an iPad
// wraps onto two rows -- so a window's title and close button were hidden behind it. On a touch
// screen with the menubar the space now starts at the bar's real bottom. A desktop with a mouse
// centres its windows and must not change.
const { test, expect } = require('./_setup');

async function openCharts(page, { touch }) {
  if (touch) {
    // The iPad gets the desktop layout from the gist, as it would in the field.
    await page.route('https://gist.githubusercontent.com/**', r => r.fulfill({ status: 200,
      contentType: 'application/json', body: JSON.stringify({ featureTabletDesktop: true }) }));
  }
  await page.goto(touch ? '?lang=he' : '?lang=he&nogist');
  await page.waitForFunction(() => document.documentElement.classList.contains('menubar')
    && !document.body.classList.contains('deck-on') && !!document.getElementById('charts'));
  await page.evaluate(() => document.getElementById('charts').click());
  const modal = page.locator('.modal-back:not(.hidden) > .modal.charts-modal');
  await expect(modal).toBeVisible();
  return page.evaluate(() => {
    const bar = document.getElementById('toolbar').getBoundingClientRect();
    const m = document.querySelector('.modal-back:not(.hidden) > .modal.charts-modal').getBoundingClientRect();
    const hit = document.elementFromPoint(m.left + m.width / 2, m.top + 6);
    return { barBottom: bar.bottom, top: m.top, height: m.height, vh: innerHeight, covered: !!(hit && hit.closest('#toolbar')) };
  });
}

test.describe('iPad with the desktop menubar', () => {
  test.use({ hasTouch: true });
  for (const [w, h] of [[1180, 820], [820, 1180], [1366, 1024]]) {
    test(`windows open below the bar, not under it (${w}x${h})`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      const r = await openCharts(page, { touch: true });
      expect(r.covered).toBe(false);
      expect(r.top).toBeGreaterThanOrEqual(r.barBottom - 1);
      expect(r.top + r.height).toBeLessThanOrEqual(r.vh + 1);
    });
  }
});

test('a desktop with a mouse still centres its windows (unchanged)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const r = await openCharts(page, { touch: false });
  expect(r.covered).toBe(false);
  expect(Math.abs(r.top - (r.vh - r.height) / 2)).toBeLessThan(2);
});
