// @ts-check
// Reported from a phone: with the route locked, a finger dragging the chart moved the map --
// except when it landed on a leg's arrow label (the kite, with the frequency on it): the press
// itself pinned the kite (made its default placement explicit), so a locked route's kites were
// edited by a finger that was only panning. A kite now behaves like a waypoint: locked, the
// map pans and the kite is left exactly as it was; unlocked, it drags. Pinned only once it moves.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof legLabelCenter === 'function');
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.00, lng: 34.90, name: 'A' }, { lat: 32.20, lng: 35.10, name: 'B' }];
    syncLegs();
    map.setView([32.10, 35.00], 11);
    draw();
  });
}

const touch = (page, type, x, y) => page.evaluate(({ type, x, y }) => {
  const el = document.getElementById('map');
  const r = el.getBoundingClientRect();
  const t = type === 'touchend' ? [] : [{ clientX: r.left + x, clientY: r.top + y, identifier: 0 }];
  const ch = [{ clientX: r.left + x, clientY: r.top + y, identifier: 0 }];
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'touches', { value: t });
  Object.defineProperty(ev, 'changedTouches', { value: ch });
  el.dispatchEvent(ev);
}, { type, x, y });

const kite = (page) => page.evaluate(() => { const c = legLabelCenter(0, 'in'); return { x: c.x, y: c.y }; });
const kiteSpot = (page) => page.evaluate(() => JSON.stringify(state.legs[0].inLabel || null));
const wpSpot = (page) => page.evaluate(() => JSON.stringify(state.waypoints[0]));

async function dragFrom(page, pt) {
  await touch(page, 'touchstart', pt.x, pt.y);
  for (let i = 1; i <= 5; i++) await touch(page, 'touchmove', pt.x + i * 10, pt.y + i * 6);
  await touch(page, 'touchend', pt.x + 50, pt.y + 30);
}

test('locked: a finger on a kite pans the map and leaves the kite as it was -- like a waypoint', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { window.editLocked = true; window.editUnlockOverride = false; });
  const k = await kite(page);
  const kBefore = await kiteSpot(page);
  await touch(page, 'touchstart', k.x, k.y);
  expect(await page.evaluate(() => map.dragging.enabled())).toBe(true);   // the map is the finger's
  expect(await kiteSpot(page)).toBe(kBefore);                              // nothing pinned on the press
  for (let i = 1; i <= 5; i++) await touch(page, 'touchmove', k.x + i * 10, k.y + i * 6);
  await touch(page, 'touchend', k.x + 50, k.y + 30);
  expect(await kiteSpot(page)).toBe(kBefore);
  // ...the same as a waypoint under the same lock.
  const w = await page.evaluate(() => { const c = map.latLngToContainerPoint([32.0, 34.9]); return { x: c.x, y: c.y }; });
  const wBefore = await wpSpot(page);
  await dragFrom(page, w);
  expect(await wpSpot(page)).toBe(wBefore);
});

test('unlocked: a kite drags at once, like a waypoint', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { window.editLocked = false; window.editUnlockOverride = false; });
  const k = await kite(page);
  const before = await kiteSpot(page);
  await touch(page, 'touchstart', k.x, k.y);
  expect(await kiteSpot(page)).toBe(before);                                // not pinned by the press
  for (let i = 1; i <= 5; i++) await touch(page, 'touchmove', k.x + i * 10, k.y - i * 10);
  await touch(page, 'touchend', k.x + 50, k.y - 50);
  expect(await kiteSpot(page)).not.toBe(before);
});

test('a tap on a kite pins nothing', async ({ page }) => {
  await boot(page);
  const k = await kite(page);
  const before = await kiteSpot(page);
  await touch(page, 'touchstart', k.x, k.y);
  await touch(page, 'touchend', k.x, k.y);
  expect(await kiteSpot(page)).toBe(before);
});
