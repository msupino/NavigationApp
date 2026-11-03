const { test, expect } = require('./_setup');

// A turning point -- marked by hand, or proven by an out-and-back -- makes the mirrored return
// meaningless. It used to only dim Show return path, which sat pressed (and stored as on)
// behind the dim with no way to turn it off. Now it switches it off.

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof refreshTurnDependentControls === 'function' && typeof setTurnWaypoint === 'function');
  await page.evaluate(() => {
    const o = window.tune;
    window.tune = (k) => (k === 'featureShowReturn' ? true : o(k));
    refreshShowReturnFeature();
  });
}
const A = { lat: 32.1, lng: 34.8, name: 'A' }, B = { lat: 32.4, lng: 35.1, name: 'B' }, C = { lat: 32.6, lng: 35.3, name: 'C' };
const state_ = (page) => page.evaluate(() => {
  const b = document.getElementById('ret-btn');
  return { on: window.showReturn, pressed: b.getAttribute('aria-pressed'), dim: b.getAttribute('aria-disabled'),
           stored: localStorage.getItem('navaid.showReturn') };
});
async function turnOn(page, wps) {
  await page.evaluate((w) => { state.waypoints = w; syncLegs(); draw(); document.getElementById('ret-btn').click(); }, wps);
  expect((await state_(page)).on).toBe(true);
}

test('marking a turning point by hand switches Show return path off', async ({ page }) => {
  await boot(page);
  await turnOn(page, [A, B, C]);
  await page.evaluate(() => { setTurnWaypoint(1); syncLegs(); draw(); });
  expect(await state_(page)).toEqual({ on: false, pressed: 'false', dim: 'true', stored: '0' });
});

test('an out-and-back route switches it off too', async ({ page }) => {
  await boot(page);
  await turnOn(page, [A, B, C]);
  await page.evaluate((w) => { state.waypoints = w; syncLegs(); draw(); }, [A, B, A]);
  expect(await state_(page)).toEqual({ on: false, pressed: 'false', dim: 'true', stored: '0' });
});

test('removing the turn does not switch it back on', async ({ page }) => {
  await boot(page);
  await turnOn(page, [A, B, C]);
  await page.evaluate(() => { setTurnWaypoint(1); syncLegs(); draw(); setTurnWaypoint(1); syncLegs(); draw(); });
  const s = await state_(page);
  expect({ on: s.on, pressed: s.pressed, dim: s.dim }).toEqual({ on: false, pressed: 'false', dim: null });
});
