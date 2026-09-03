// @ts-check
// Chart modals are non-blocking (the map stays pannable underneath), which they get by
// reusing the flight plan's backdrop class. That class also carries z-index 2000, below
// the inspector's 2320 — so field plates opened from an airfield inspector rendered
// UNDERNEATH the panel that launched them. On a phone the inspector is a bottom sheet
// covering ~62dvh, so most of the plates list was hidden behind it.
const { test, expect } = require('./_setup');

const PHONE = { width: 390, height: 844 };

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => !document.getElementById('boot-loading'));
  await page.waitForFunction(() => typeof showChartsModal === "function");
}

const zOf = el => el.evaluate(e => parseInt(getComputedStyle(e).zIndex, 10));

test('field plates stack above the inspector that opened them', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await boot(page);
  await page.evaluate(() => showChartsModal());
  const back = page.locator('.modal-back[data-chart-modal="airport-charts"]');
  await expect(back).toBeVisible();

  const insp = page.locator('#inspector');
  const inspZ = await insp.evaluate(e => parseInt(getComputedStyle(e).zIndex, 10));
  expect(await zOf(back)).toBeGreaterThan(inspZ);
});

test('the raised backdrop still lets the map through', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await boot(page);
  await page.evaluate(() => showChartsModal());
  const back = page.locator('.modal-back[data-chart-modal="airport-charts"]');
  // The whole point of nonBlocking: raising it must not turn it into a click trap.
  expect(await back.evaluate(e => getComputedStyle(e).pointerEvents)).toBe('none');
  expect(await back.evaluate(e => getComputedStyle(e).backgroundColor))
    .toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  // ...while the dialog itself stays clickable.
  expect(await page.locator('.modal-back[data-chart-modal="airport-charts"] > .modal')
    .evaluate(e => getComputedStyle(e).pointerEvents)).toBe('auto');
});

test('the flight plan keeps its own place below the inspector', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await boot(page);
  await page.evaluate(() => showChartsModal());
  const back = page.locator('.modal-back[data-chart-modal="airport-charts"]');
  // The rule is scoped to chart modals by their data attribute; a plain non-blocking
  // backdrop (the flight plan) must not be dragged up with them.
  const plainZ = await page.evaluate(() => {
    const d = document.createElement('div');
    d.className = 'modal-back flight-plan';
    document.body.appendChild(d);
    const z = parseInt(getComputedStyle(d).zIndex, 10);
    d.remove();
    return z;
  });
  expect(await zOf(back)).toBeGreaterThan(plainZ);
});
