// @ts-check
// Charts submenu behaviour on desktop: opening ANY chart-menu item closes the
// Charts submenu — uniform across every item. Escape with the submenu open (no
// item opened) also closes it. Previously several chart items
// (sigwx/pwx/sigmet/notam/lsa/mosaic) were missing from the close-after set and
// wrongly left the submenu open; this asserts the fixed, uniform behaviour.
const { test, expect } = require('./_setup');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });   // desktop menu-bar mode
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    document.querySelector('[data-sec="charts"] .tb-section-head'));
});

async function openCharts(page) {
  await page.locator('[data-sec="charts"] .tb-section-head').click();
  await expect(page.locator('[data-sec="charts"]')).toHaveClass(/open/);
}

// A couple of representative chart items across the section. freq-table opens a
// local modal; sigmet-btn is one of the items that used to keep the submenu
// open — both must now close it, proving uniformity.
for (const id of ['freq-table', 'sigmet-btn']) {
  test(`opening #${id} closes the Charts submenu`, async ({ page }) => {
    await openCharts(page);
    await page.locator(`#${id}`).click();
    // The close is scheduled via setTimeout(0) after the command's own handler.
    await expect(page.locator('[data-sec="charts"]')).not.toHaveClass(/open/);
  });
}

test('Escape closes the Charts submenu when no item has been opened', async ({ page }) => {
  await openCharts(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-sec="charts"]')).not.toHaveClass(/open/);
});
