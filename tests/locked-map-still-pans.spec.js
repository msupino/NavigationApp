// With the route locked, the map must still pan from anywhere — including from on top of a
// waypoint, a kite, a callout or a cumulative-time arrow.
//
// A press on something draggable normally takes Leaflet's drag away, so the gesture moves
// the thing instead of the chart. Locked, nothing was going to move, and taking the pan away
// anyway left the map stuck wherever the route lay across it — which on a kneeboard is most
// of the screen.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof dragLockedNow === 'function');
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.90, name: 'A' },
      { lat: 32.20, lng: 35.10, name: 'B' },
    ];
    map.setView([32.10, 35.00], 11);
    draw();
  });
}

const setLock = (page, on) => page.evaluate((v) => {
  window.editLocked = v;
  if (typeof setEditLocked === 'function') setEditLocked(v);
  return dragLockedNow('wp');
}, on);

// Press where the first waypoint is drawn.
const pressWaypoint = (page) => page.evaluate(() => {
  const p = map.latLngToContainerPoint(L.latLng(state.waypoints[0].lat, state.waypoints[0].lng));
  const el = map.getContainer();
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true, clientX: r.left + p.x, clientY: r.top + p.y }));
  return { draggingEnabled: map.dragging.enabled(), kind: drag && drag.kind };
});

const release = (page) => page.evaluate(() => {
  map.getContainer().dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  map.dragging.enable();
});

test('locked, a press on a waypoint leaves the map free to pan', async ({ page }) => {
  await boot(page);
  expect(await setLock(page, true)).toBe(true);
  const got = await pressWaypoint(page);
  expect(got.draggingEnabled).toBe(true);
  await release(page);
});

test('unlocked, the same press takes the drag so the waypoint moves, not the chart', async ({ page }) => {
  await boot(page);
  expect(await setLock(page, false)).toBe(false);
  const got = await pressWaypoint(page);
  expect(got.kind).toBe('wp');
  expect(got.draggingEnabled).toBe(false);
  await release(page);
});

test('every lockable kind frees the map while locked, and holds it while unlocked', async ({ page }) => {
  await boot(page);
  const kinds = await page.evaluate(() => LOCKABLE_DRAG_KINDS.slice());
  expect(kinds).toEqual(['wp', 'note', 'label', 'cumlabel', 'cumlabelret']);
  for (const on of [true, false]) {
    await setLock(page, on);
    const held = await page.evaluate((ks) => ks.map((k) => {
      map.dragging.enable();
      const took = holdMapForDrag(k);
      const enabled = map.dragging.enabled();
      map.dragging.enable();
      return { k, took, enabled };
    }), kinds);
    for (const h of held) {
      expect(h.took).toBe(!on);
      expect(h.enabled).toBe(on);   // locked -> Leaflet keeps the pan
    }
  }
});

// The page frame is print layout, not the route: the lock has never covered it and must not
// start now, or a locked map cannot have its print frame adjusted at all.
test('the page frame is unaffected by the route lock', async ({ page }) => {
  await boot(page);
  await setLock(page, true);
  expect(await page.evaluate(() => dragLockedNow('page'))).toBe(false);
});

test('a pan that starts on a locked waypoint is not a tap on release', async ({ page }) => {
  await boot(page);
  await setLock(page, true);
  const moved = await page.evaluate(() => {
    drag = { kind: 'wp', i: 0, moved: false };
    map.fire('movestart');
    const m = drag.moved;
    drag = null;
    return m;
  });
  expect(moved).toBe(true);
});
