// A drag armed before a pinch must not resume after it.
//
// The press that armed the drag happened in the pre-zoom view, so touchDrag.startX/startY are
// in pixels that no longer mean anything. When the fingers drop back to one, the slop check
// measured against that stale point, cleared instantly, and the waypoint jumped to wherever
// the surviving finger was -- occasionally close enough to a neighbour to take the
// delete-on-overlap path with it. mousedown, click and endTouch all consult
// touchGestureInProgress() already; the touchmove arming path did not.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function'
    && typeof touchGestureInProgress === 'function');
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.90, name: 'A' },
      { lat: 32.10, lng: 35.00, name: 'B' },
      { lat: 32.20, lng: 35.10, name: 'C' },
    ];
    if (typeof syncLegs === 'function') syncLegs();
    map.setView([32.10, 35.00], 11);
    draw();
  });
}

// A one-finger touch at a container point, as the app's own handlers see it.
const touchAt = (page, phase, x, y, fingers) => page.evaluate(({ phase, x, y, fingers }) => {
  const el = document.getElementById('map');
  const r = el.getBoundingClientRect();
  const mk = (n) => Array.from({ length: n }, (_, i) => ({
    clientX: r.left + x + i * 40, clientY: r.top + y, identifier: i }));
  const ev = new Event(phase, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'touches', { value: mk(fingers) });
  Object.defineProperty(ev, 'changedTouches', { value: mk(Math.max(1, fingers)) });
  el.dispatchEvent(ev);
}, { phase, x, y, fingers });

const wpAt = (page, i) => page.evaluate((n) => {
  const w = state.waypoints[n];
  return { lat: w.lat, lng: w.lng, name: w.name };
}, i);

const pressWp = (page, i) => page.evaluate((n) => {
  const w = state.waypoints[n];
  return map.latLngToContainerPoint(L.latLng(w.lat, w.lng));
}, i);

test('a pinch between press and move leaves the waypoint where it was', async ({ page }) => {
  await boot(page);
  const before = await wpAt(page, 1);
  const p = await pressWp(page, 1);

  await touchAt(page, 'touchstart', p.x, p.y, 1);          // press the middle waypoint
  await touchAt(page, 'touchstart', p.x, p.y, 2);          // ...second finger: a pinch
  await touchAt(page, 'touchend', p.x, p.y, 1);            // ...one finger lifts
  // Far past the slop, and nowhere near where the press landed.
  await touchAt(page, 'touchmove', p.x + 180, p.y + 140, 1);

  expect(await wpAt(page, 1)).toEqual(before);
  await touchAt(page, 'touchend', p.x + 180, p.y + 140, 0);
});

// What the guard is: a window that opens on a second finger and on the lift that ends a
// pinch. Pinned here because the fix depends on the touchmove path consulting it, and a
// window that never opens would make the test above pass for the wrong reason.
test('the pinch opens the gesture window the fix depends on', async ({ page }) => {
  await boot(page);
  const p = await pressWp(page, 1);
  expect(await page.evaluate(() => touchGestureInProgress())).toBe(false);
  await touchAt(page, 'touchstart', p.x, p.y, 2);
  expect(await page.evaluate(() => touchGestureInProgress())).toBe(true);
  await touchAt(page, 'touchend', p.x, p.y, 1);
  expect(await page.evaluate(() => touchGestureInProgress())).toBe(true);
  await touchAt(page, 'touchend', p.x, p.y, 0);
});

test('no pinch, no guard: a plain drag still moves the waypoint', async ({ page }) => {
  await boot(page);
  const before = await wpAt(page, 1);
  const p = await pressWp(page, 1);
  await touchAt(page, 'touchstart', p.x, p.y, 1);
  await touchAt(page, 'touchmove', p.x + 60, p.y + 50, 1);
  const after = await wpAt(page, 1);
  await touchAt(page, 'touchend', p.x + 60, p.y + 50, 0);
  expect(after).not.toEqual(before);
});
