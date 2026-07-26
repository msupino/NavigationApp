// @ts-check
// Charts submenu behaviour on desktop: opening ANY chart-menu item closes the
// Charts submenu — uniform across every item. Escape with the submenu open (no
// item opened) also closes it. Previously several chart items
// (sigwx/pwx/sigmet/notam/lsa/mosaic) were missing from the close-after set and
// wrongly left the submenu open; this asserts the fixed, uniform behaviour.
const { test, expect } = require('./_setup');

// #sigmet-btn ships hidden and is only unhidden when the SIGMET feed has
// entries, so clicking it without a stub made this test depend on live Israeli
// weather (and on reaching raw.githubusercontent.com from CI) — it would block on
// Playwright's visibility auto-wait until timeout whenever the feed was empty.
// Serve a deterministic one-SIGMET payload instead.
const SIGMET_FIXTURE = {
  generatedAt: '2026-01-01T00:00:00Z',
  sigmets: [{
    hazard: 'TS', rawSigmet: 'LLLL SIGMET 1 VALID',
    coords: [[32.0, 34.6], [32.6, 34.6], [32.6, 35.4], [32.0, 35.4]],
  }],
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });   // desktop menu-bar mode
  await page.route(/sigmet\.json/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SIGMET_FIXTURE) }));
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    document.querySelector('[data-sec="charts"] .tb-section-head'));
  // Load the stubbed feed and unhide the button so the click below is stable.
  await page.evaluate(async () => {
    if (typeof loadSigmets === 'function') await loadSigmets(true);
    if (typeof refreshSigmetBtn === 'function') refreshSigmetBtn();
  });
  // It lives inside the (still closed) Charts dropdown, so assert the `hidden`
  // property rather than visibility.
  await page.waitForFunction(() => {
    const b = document.getElementById('sigmet-btn');
    return !!b && b.hidden === false;
  });
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
