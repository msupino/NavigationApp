// @ts-check
// On narrow phones the chart modals must keep their close-✕ on-screen and
// tappable (they used to overflow because .modal.wide forced a 520px min-width).
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 390, height: 740 } });

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof showRouteMosaicModal === 'function' && typeof showFreqTableModal === 'function');
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.18, lng: 34.83, name: 'LLHZ' },
      { lat: 32.55, lng: 34.92, name: 'HADERA' },
    ];
    if (typeof syncLegs === 'function') syncLegs();
  });
}

async function closeXOnScreen(page, modalSel) {
  return page.evaluate(sel => {
    const m = document.querySelector(sel);
    const x = m && m.querySelector('.modal-close-x');
    if (!x) return { found: false };
    const r = x.getBoundingClientRect();
    return {
      found: true,
      onScreen: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
      size: Math.min(r.width, r.height),
    };
  }, modalSel);
}

test('mosaic close-✕ stays on-screen and closes on a phone', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.getElementById('mosaic-btn').click());
  const modal = page.locator('.route-mosaic-modal');
  await expect(modal).toBeVisible();
  const x = await closeXOnScreen(page, '.route-mosaic-modal');
  expect(x.found).toBe(true);
  expect(x.onScreen).toBe(true);
  expect(x.size).toBeGreaterThanOrEqual(20);
  await modal.locator('.modal-close-x').click();
  await expect(page.locator('.route-mosaic-modal')).toHaveCount(0);
});

test('NOTAM list + Freq table close-✕ stay on-screen on a phone', async ({ page }) => {
  await boot(page);
  for (const [open, sel] of [
    [() => showNotamModal(), '.notam-modal'],
    [() => showFreqTableModal(), '.modal-back[data-chart-modal="freq-table"] .modal'],
  ]) {
    await page.evaluate(open);
    await expect(page.locator(sel).first()).toBeVisible();
    const x = await closeXOnScreen(page, sel);
    expect(x.found).toBe(true);
    expect(x.onScreen).toBe(true);
    await page.locator(sel).first().locator('.modal-close-x').click();
  }
});
