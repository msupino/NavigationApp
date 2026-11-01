const { test, expect } = require('./_setup');

// Buttons that act on the route are dimmed while there is not enough route for them to do
// anything, and a tap says why instead of running (setButtonWhy). A route brings them back.
const IDS = ['clear', 'fit', 'edit-col-fit', 'plan', 'nav-log', 'share', 'fly', 'mosaic-btn', 'route-check-btn'];

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof window.refreshRouteButtons === 'function' && typeof syncLegs === 'function');
  await page.waitForFunction(() => document.getElementById('plan').getAttribute('aria-disabled') === 'true');
}
const dims = (page) => page.evaluate((ids) => Object.fromEntries(ids.map(id => {
  const el = document.getElementById(id);
  return [id, el ? el.getAttribute('aria-disabled') === 'true' : 'missing'];
})), IDS);
const route = (page, pts) => page.evaluate((p) => {
  state.waypoints = p.map(([lat, lng], i) => ({ lat, lng, name: 'P' + i }));
  syncLegs(); draw();
}, pts);

test('an empty map dims every route action', async ({ page }) => {
  await boot(page);
  const d = await dims(page);
  // Clear map also clears shown extra layers, so it follows the map column's Clear (below).
  for (const id of IDS.filter(i => i !== 'clear')) expect([id, d[id]]).toEqual([id, true]);
});

test("the menu's Clear map dims exactly when the map's Clear does", async ({ page }) => {
  await boot(page);
  const pair = () => page.evaluate(() => ['clear', 'edit-col-clear'].map(id =>
    document.getElementById(id).getAttribute('aria-disabled') === 'true'));
  const [m0, c0] = await pair();
  expect(m0).toBe(c0);
  // Nothing on the map and no extra layer shown: both dim.
  await page.evaluate(() => {
    for (const cb of document.querySelectorAll('.tb-section[data-sec="weather"] input[type="checkbox"]:checked')) cb.click();
    refreshEditColumn();
  });
  expect(await pair()).toEqual([true, true]);
});

test('a tap on a dimmed one says why and does not run it', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    window.__said = [];
    const real = window.showToast;
    window.showToast = (m, o) => { window.__said.push(String(m)); return real && real(m, o); };
    document.getElementById('plan').click();
    return { said: window.__said, open: !!document.querySelector('.modal-back.flight-plan') };
  });
  expect(out.open).toBe(false);
  expect(out.said.join(' ')).toContain('No legs yet');
});

test('a two-point route brings them all back', async ({ page }) => {
  await boot(page);
  await route(page, [[32.1, 34.8], [32.4, 35.1]]);
  const d = await dims(page);
  for (const id of IDS) expect([id, d[id]]).toEqual([id, false]);
});

test('one point: what one point can do comes back, the rest stay dimmed', async ({ page }) => {
  await boot(page);
  await route(page, [[32.1, 34.8]]);
  const d = await dims(page);
  expect({ clear: d.clear, fit: d.fit, mosaic: d['mosaic-btn'] }).toEqual({ clear: false, fit: false, mosaic: false });
  expect({ plan: d.plan, share: d.share, fly: d.fly, check: d['route-check-btn'], log: d['nav-log'] })
    .toEqual({ plan: true, share: true, fly: true, check: true, log: true });
});
