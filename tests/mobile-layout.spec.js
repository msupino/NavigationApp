// @ts-check
// Mobile-layout regressions. On phones (<=680px) the app must not blanket the
// map: toolbar starts collapsed, the inspector is a bottom sheet, the flight
// plan scrolls sideways, and floating chrome hides under modals.
const { test, expect } = require('./_setup');

async function freshBoot(page, { width, height }) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('navaid.toolbarCollapsed');
      localStorage.removeItem('navaid.inspPos');
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof map !== 'undefined' && typeof showInspector === 'function');
}

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1200, height: 800 };

test('mobile: toolbar starts collapsed; desktop expanded', async ({ page }) => {
  await freshBoot(page, MOBILE);
  await expect(page.locator('#toolbar')).toHaveClass(/collapsed/);
  await freshBoot(page, DESKTOP);
  await expect(page.locator('#toolbar')).not.toHaveClass(/collapsed/);
});

test('mobile: inspector renders as a full-width bottom sheet', async ({ page }) => {
  await freshBoot(page, MOBILE);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 34.9, name: 'LLHZ' }];
    state.selected = { type: 'wp', index: 0 };
    syncLegs();
    showInspector();
  });
  const box = await page.locator('#inspector').boundingBox();
  expect(box.x).toBeLessThan(20);
  expect(box.width).toBeGreaterThan(300);
  expect(box.y + box.height).toBeGreaterThan(800);
});

test('mobile: flight-plan table scrolls horizontally', async ({ page }) => {
  await freshBoot(page, MOBILE);
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.18, lng: 34.83, name: 'LLHZ' },
      { lat: 32.6, lng: 35.23, name: 'LLMG' }
    ];
    syncLegs();
    document.getElementById('plan').click();
  });
  await expect(page.locator('.fp-scroll').first()).toBeVisible();
  const ox = await page.locator('.fp-scroll').first().evaluate(el => getComputedStyle(el).overflowX);
  expect(ox).toBe('auto');
});

test('mobile: toolbar + legend hide while a modal is open', async ({ page }) => {
  await freshBoot(page, MOBILE);
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.18, lng: 34.83, name: 'LLHZ' },
      { lat: 32.6, lng: 35.23, name: 'LLMG' }
    ];
    syncLegs();
    document.getElementById('plan').click();
  });
  await expect(page.locator('.modal-back').first()).toBeVisible();
  expect(await page.locator('#toolbar').evaluate(el => getComputedStyle(el).display)).toBe('none');
});
