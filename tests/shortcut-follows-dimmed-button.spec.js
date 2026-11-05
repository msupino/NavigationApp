// @ts-check
// Reported: "the fit button on map is dimmed when no route set, but F on keyboard still zooms to
// map" -- and asked to check every shortcut. A key that stands for a button does what the button
// does, including saying no: with the button dimmed, the key shows the button's reason and does
// nothing. The selection keys (D, Delete, X, Z) refuse while the route is locked, like the panel
// buttons they mirror.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof draw === 'function'
    && !!document.getElementById('edit-col-fit'));
  await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
}
const toast = page => page.evaluate(() => {
  const el = [...document.querySelectorAll('#toast-stack .toast')].pop();
  return el ? el.textContent : '';
});
const view = page => page.evaluate(() => { const c = map.getCenter(); return [c.lat.toFixed(4), c.lng.toFixed(4), map.getZoom()]; });
async function route(page) {
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'DEROR' }, { lat: 32.57, lng: 35.19, name: 'ZMGID' }];
    state.legs = [{ speed: 90 }];
    draw();
  });
}
const lock = page => page.evaluate(() => { window.editLocked = true; draw(); if (window.refreshEditColumn) refreshEditColumn(); });

test('F with nothing to fit says so and leaves the map where it is', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => map.setView([31.5, 34.9], 11, { animate: false }));
  const before = await view(page);
  await page.keyboard.press('f');
  expect(await view(page)).toEqual(before);
  expect(await toast(page)).toContain('Nothing to fit yet');
});

test('F with a route still fits it', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => map.setView([30.0, 34.0], 13, { animate: false }));
  const before = await view(page);
  await page.keyboard.press('f');
  expect(await view(page)).not.toEqual(before);
});

test('Ctrl+Z with nothing to undo says so', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Control+z');
  expect(await toast(page)).toContain('Nothing to undo');
});

test('a locked route: Ctrl+Z, D and Delete refuse with the lock message and change nothing', async ({ page }) => {
  await boot(page);
  await route(page);
  // Something to undo, then lock.
  await page.evaluate(() => { state.waypoints.push({ lat: 32.7, lng: 35.3, name: 'X' }); state.legs.push({ speed: 90 }); draw(); });
  await lock(page);
  const count = () => page.evaluate(() => state.waypoints.length);
  const n = await count();
  await page.keyboard.press('Control+z');
  expect(await count()).toBe(n);
  expect(await toast(page)).toMatch(/locked/i);
  await page.evaluate(() => { state.selected = { type: 'wp', index: 0 }; });
  for (const key of ['d', 'Delete']) {
    await page.keyboard.press(key);
    expect(await count()).toBe(n);
  }
  expect(await toast(page)).toMatch(/locked/i);
});

test('a read-only pick is not "locked": Delete on an airfield stays quiet', async ({ page }) => {
  await boot(page);
  await route(page);
  await lock(page);
  await page.waitForFunction(() => Array.isArray(window.airfields) && airfields.length > 0);
  await page.evaluate(() => { document.querySelectorAll('#toast-stack .toast').forEach(t => t.remove()); state.selected = { type: 'airfield', index: 0 }; });
  await page.keyboard.press('Delete');
  expect(await toast(page)).toBe('');
});
