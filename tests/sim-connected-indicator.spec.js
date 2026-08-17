// @ts-check
// Reported: nothing in the menu bar says the simulator is connected — you had to open the
// panel to find out. The two GPS buttons beside it already carry their state; the plane
// icon now carries its own, the same way, so one glance reads all three sources alike.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof simStart === 'function' &&
    !!document.getElementById('sim-trigger'));
  // The poll must not reach a real bridge; answer it here.
  await page.route(/^http:\/\/localhost:2020\//, r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ latitude: 32.1, longitude: 34.9, altitude: 1500, heading: 90, ias: 95 }),
  }));
}

const iconState = (page) => page.evaluate(() => {
  const b = document.getElementById('sim-trigger');
  return {
    pressed: b.getAttribute('aria-pressed'),
    label: b.getAttribute('aria-label') || '',
    latched: b.classList.contains('gps-footer-btn'),
  };
});

test('the plane icon is unlatched until the simulator connects', async ({ page }) => {
  await boot(page);
  const off = await iconState(page);
  expect(off.pressed).toBe('false');
  expect(off.label).not.toMatch(/connected/i);
});

test('connecting latches it, disconnecting releases it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => simStart());
  const on = await iconState(page);
  expect(on.pressed).toBe('true');
  expect(on.latched).toBe(true);                 // same treatment as the GPS buttons
  expect(on.label).toMatch(/connected/i);
  await page.evaluate(() => simStop());
  const off = await iconState(page);
  expect(off.pressed).toBe('false');
  expect(off.label).not.toMatch(/connected/i);
});

test('a session resumed on boot shows as connected without opening the panel', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.simOn', '1'); } catch (e) { /* */ }
  });
  await boot(page);
  await page.waitForFunction(() => document.getElementById('sim-trigger').getAttribute('aria-pressed') === 'true');
  expect((await iconState(page)).pressed).toBe('true');
  expect(await page.evaluate(() => document.getElementById('sim-modal').classList.contains('hidden'))).toBe(true);
});
