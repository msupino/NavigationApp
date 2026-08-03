// The toolbar input is not the only thing that moves the in-force default leg speed.
// The dev tuning panel (its number input, its per-key reset, and reset-all) and a Drive
// settings win followed by a reload all change it too -- and each one used to leave the
// legs still following it behind at the old number, so the pilot saw a control whose
// value the route did not match and had no reason to touch. Every one of these fails on
// the pre-fix tree (e221e11): legs stay 90 while the control reads the new value.
const { test, expect } = require('./_setup');

async function boot(page, q = '?lang=en&nogist') {
  await page.addInitScript(() => {
    try {
      for (const sec of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + sec, '1');
    } catch (e) {}
  });
  await page.goto(q);
  await page.waitForFunction(() => typeof tune === 'function' && typeof syncLegs === 'function');
}

async function route(page, n = 4) {
  await page.evaluate(count => {
    state.waypoints = [];
    for (let i = 0; i < count; i++) state.waypoints.push({ lat: 32 + i * 0.1, lng: 34.9, name: 'W' + i });
    syncLegs();
    draw();
  }, n);
}

// Panel rows live inside collapsed <details> groups; a hidden input can't be filled.
async function openTuningPanel(page) {
  await page.waitForFunction(() => !!document.getElementById('tuning-panel'));
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('#tuning-panel details')) d.open = true;
  });
  await page.waitForSelector('#tune-defaultLegSpeedKt-number', { state: 'visible' });
}

// Raise the default through the TOOLBAR input. That path carried the route even before
// the fix, so a reset test built on it isolates what the reset does instead of passing
// vacuously because the legs never left 90 in the first place.
async function setViaToolbar(page, kt) {
  await page.fill('#default-speed', String(kt));
  await page.dispatchEvent('#default-speed', 'change');
}

const speeds = page => page.evaluate(() =>
  state.legs.map(l => [l.flightSpeed, l.outboundSpeed, l._legSpeedAuto ? 'auto' : 'manual']));

test('the tuning panel number input carries the route, and the toolbar follows', async ({ page }) => {
  await boot(page, '?lang=en&nogist&tune=1');
  await openTuningPanel(page);
  await route(page);
  expect((await speeds(page)).every(l => l[0] === 90)).toBe(true);

  await page.fill('#tune-defaultLegSpeedKt-number', '120');
  await page.dispatchEvent('#tune-defaultLegSpeedKt-number', 'input');

  expect(await page.evaluate(() => tune('defaultLegSpeedKt'))).toBe(120);
  expect((await speeds(page)).every(l => l[0] === 120 && l[1] === 120 && l[2] === 'auto')).toBe(true);
  // The toolbar control must not be left showing a stale number either.
  await expect(page.locator('#default-speed')).toHaveValue('120');
});

test('a hand-typed leg still resists the tuning panel', async ({ page }) => {
  await boot(page, '?lang=en&nogist&tune=1');
  await openTuningPanel(page);
  await route(page);
  await page.evaluate(() => {
    const old = state.legs[1].flightSpeed;
    state.legs[1].flightSpeed = 70;
    propagateAlt(1, 'flightSpeed', 70, old);
  });
  await page.fill('#tune-defaultLegSpeedKt-number', '120');
  await page.dispatchEvent('#tune-defaultLegSpeedKt-number', 'input');
  const s = await speeds(page);
  expect(s[1][0]).toBe(70);
  expect(s[0][0]).toBe(120);
});

test('the per-key reset carries the route back to the shipped default', async ({ page }) => {
  await boot(page, '?lang=en&nogist&tune=1');
  await openTuningPanel(page);
  await route(page);
  await setViaToolbar(page, 120);
  expect((await speeds(page)).every(l => l[0] === 120)).toBe(true);

  await page.click('#tune-defaultLegSpeedKt-reset');
  expect(await page.evaluate(() => tune('defaultLegSpeedKt'))).toBe(90);
  expect((await speeds(page)).every(l => l[0] === 90 && l[1] === 90)).toBe(true);
  await expect(page.locator('#default-speed')).toHaveValue('90');
});

test('reset-all carries the route too', async ({ page }) => {
  await boot(page, '?lang=en&nogist&tune=1');
  await openTuningPanel(page);
  await route(page);
  await setViaToolbar(page, 120);
  expect((await speeds(page)).every(l => l[0] === 120)).toBe(true);
  await page.click('#tune-reset-all');      // icon button, no text to match on
  expect(await page.evaluate(() => tune('defaultLegSpeedKt'))).toBe(90);
  expect((await speeds(page)).every(l => l[0] === 90)).toBe(true);
});

// A Drive settings win writes the key and then reloads the page (ui.js schedules the
// reload after the merge). The reloaded session restores the route with its pins intact,
// so the legs must pick up the speed that arrived from the other device.
test('a Drive settings win that writes the key and reloads carries the route', async ({ page }) => {
  await boot(page);
  await route(page, 3);
  await page.evaluate(() => flushPersist());
  await page.evaluate(() => localStorage.setItem('navaid.defaultSpeed', '105'));

  await boot(page);
  await page.waitForFunction(() => state.legs.length === 2);
  expect(await page.evaluate(() => tune('defaultLegSpeedKt'))).toBe(105);
  await expect(page.locator('#default-speed')).toHaveValue('105');
  expect((await speeds(page)).every(l => l[0] === 105 && l[1] === 105 && l[2] === 'auto')).toBe(true);
});

test('a Drive win does not touch the legs the pilot typed speeds on', async ({ page }) => {
  await boot(page);
  await route(page, 4);
  await page.evaluate(() => {
    const old = state.legs[1].flightSpeed;
    state.legs[1].flightSpeed = 70;
    propagateAlt(1, 'flightSpeed', 70, old);
    flushPersist();
  });
  await page.evaluate(() => localStorage.setItem('navaid.defaultSpeed', '105'));

  await boot(page);
  await page.waitForFunction(() => state.legs.length === 3);
  const s = await speeds(page);
  expect(s[1][0]).toBe(70);          // pinned leg survived the reload and the new default
  expect(s[0][0]).toBe(105);
});
