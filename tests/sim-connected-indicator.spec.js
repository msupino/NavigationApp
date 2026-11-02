// @ts-check
// Reported: nothing in the menu bar says the simulator is connected — you had to open the
// panel to find out. The two GPS buttons beside it already carry their state; the plane
// icon now carries its own, the same way, so one glance reads all three sources alike.
const { test, expect, captureToasts } = require('./_setup');

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

// Asked: "pressing on sim button when active, should disable, not open the connect window".
// Connected, the plane button is a switch like Location and Record: a press disconnects (the
// panel's own state with it) and says so; disconnected, it opens the panel.
test('pressing the plane button while connected disconnects instead of opening the panel', async ({ page }) => {
  await boot(page);
  // Connect the way a pilot does: open the panel, press Connect, close it.
  await page.locator('#sim-trigger').click();
  await expect(page.locator('#sim-modal')).not.toHaveClass(/hidden/);
  await page.locator('#sim-connect-cb').click();
  // Connect closes the window by itself (asked: "connect to sim button in sim window should
  // close when click to connect").
  await expect(page.locator('#sim-modal')).toHaveClass(/hidden/);
  expect((await iconState(page)).pressed).toBe('true');
  expect((await iconState(page)).label).toMatch(/tap to disconnect/);

  await page.locator('#sim-trigger').click();
  expect((await iconState(page)).pressed).toBe('false');
  await expect(page.locator('#sim-modal')).toHaveClass(/hidden/);           // not opened
  expect(await page.evaluate(() => [window.simOn, localStorage.getItem('navaid.simOn')])).toEqual([false, '0']);
  // The panel's own button follows: it offers to connect again.
  expect(await page.locator('#sim-connect-cb').textContent()).toMatch(/Connect to simulator/);

  // Disconnected, the same press opens the panel.
  await page.locator('#sim-trigger').click();
  await expect(page.locator('#sim-modal')).not.toHaveClass(/hidden/);
});

test('a bad bridge URL keeps the window open, with the problem shown', async ({ page }) => {
  await boot(page);
  await page.locator('#sim-trigger').click();
  await page.locator('#sim-url').fill('not a url');
  await page.locator('#sim-connect-cb').click();
  await expect(page.locator('#sim-modal')).not.toHaveClass(/hidden/);
  expect((await iconState(page)).pressed).toBe('false');
});

// The window closes on Connect, so its status line is out of sight: the first state after
// connecting is said in a toast instead -- once, not on every poll.
test('after Connect closes the window, the status arrives as a toast, once', async ({ page }) => {
  await boot(page);
  const toasts = await captureToasts(page);
  await page.locator('#sim-trigger').click();
  await page.locator('#sim-connect-cb').click();
  await expect(page.locator('#sim-modal')).toHaveClass(/hidden/);
  await expect.poll(async () => (await toasts()).filter(t => /Simulator connected/.test(t)).length).toBe(1);
  await page.waitForTimeout(2500);                       // more polls: no repeat
  expect((await toasts()).filter(t => /Simulator connected/.test(t)).length).toBe(1);
});
