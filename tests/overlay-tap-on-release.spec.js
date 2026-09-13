// @ts-check
// Reported, repeatedly: dragging the map on a phone with a finger that happens to be on a
// waypoint still opens the inspector. It should open on RELEASE, not on the press.
//
// Everything on the route — waypoints, kites, notes, legs — has been decided in endTouch for
// some time. The chart markers were not: a VOR, an airfield or a nav waypoint opened its panel
// on touchstart, through an early return that skipped that machinery entirely. So a finger that
// landed on one and then dragged the map got the panel anyway.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof showInspector === 'function'
    && Array.isArray(window.airfields) && window.airfields.length);
  // Centre the map on a published airfield and make sure its marker is being drawn: a chart
  // point the pilot's finger can land on without any route existing.
  return page.evaluate(() => {
    const af = window.airfields.find(a => a && Number.isFinite(a.lat) && Number.isFinite(a.lng));
    window.showAirfields = true;
    // A route exists, so the map is not PRIMED: while the empty-route hint is up a press on a
    // chart point deliberately falls through to the add path instead of inspecting it.
    state.waypoints = [{ lat: af.lat + 0.6, lng: af.lng + 0.6, name: 'A' },
                       { lat: af.lat + 0.8, lng: af.lng + 0.7, name: 'B' }];
    syncLegs();
    if (typeof dismissRoutePriming === 'function') dismissRoutePriming();
    map.setView([af.lat, af.lng], 12);
    draw();
    const pt = map.latLngToContainerPoint([af.lat, af.lng]);
    return { x: Math.round(pt.x), y: Math.round(pt.y) };
  });
}

const panelOpen = (page) => page.evaluate(() =>
  !document.getElementById('inspector').classList.contains('hidden'));

// One finger, from (x,y), moved by (dx,dy) in steps, then lifted.
const touchDrag = (page, x, y, dx, dy) => page.evaluate(({ x0, y0, ddx, ddy }) => {
  const el = map.getContainer();
  const touch = (cx, cy) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy,
                                        pageX: cx, pageY: cy });
  const fire = (type, cx, cy) => {
    const list = type === 'touchend' ? [] : [touch(cx, cy)];
    el.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true, touches: list, targetTouches: list,
      changedTouches: [touch(cx, cy)],
    }));
  };
  fire('touchstart', x0, y0);
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    fire('touchmove', x0 + (ddx * i) / steps, y0 + (ddy * i) / steps);
  }
  fire('touchend', x0 + ddx, y0 + ddy);
}, { x0: x, y0: y, ddx: dx, ddy: dy });

const touchTap = (page, x, y) => touchDrag(page, x, y, 0, 0);

test('a finger that starts on a chart point and drags the map opens nothing', async ({ page }) => {
  const at = await boot(page);
  await touchDrag(page, at.x, at.y, 90, 70);
  expect(await panelOpen(page), 'the panel opened on a pan').toBe(false);
  expect(await page.evaluate(() => state.selected)).toBe(null);
});

test('...and a tap on the same point still opens it', async ({ page }) => {
  const at = await boot(page);
  await touchTap(page, at.x, at.y);
  expect(await panelOpen(page)).toBe(true);
  expect(await page.evaluate(() => state.selected && state.selected.type)).toBeTruthy();
});

test('nothing opens on the way down — the press alone decides nothing', async ({ page }) => {
  const at = await boot(page);
  const duringPress = await page.evaluate(({ x, y }) => {
    const el = map.getContainer();
    const point = new Touch({ identifier: 1, target: el, clientX: x, clientY: y,
                             pageX: x, pageY: y });
    el.dispatchEvent(new TouchEvent('touchstart', {
      bubbles: true, cancelable: true, touches: [point], changedTouches: [point],
      targetTouches: [point],
    }));
    return !document.getElementById('inspector').classList.contains('hidden');
  }, at);
  expect(duringPress, 'the panel opened before the finger lifted').toBe(false);
});

test('a pan leaves whatever was open before exactly as it was', async ({ page }) => {
  const at = await boot(page);
  await page.evaluate(() => {
    state.selected = { type: 'leg', index: 0 };
    showInspector();
    draw();
  });
  await touchDrag(page, at.x, at.y, 80, 60);
  const after = await page.evaluate(() => ({
    open: !document.getElementById('inspector').classList.contains('hidden'),
    sel: state.selected,
  }));
  // The pilot was reading a leg and moved the chart. Neither the reading nor the selection is
  // the gesture's business.
  expect(after.open).toBe(true);
  expect(after.sel).toEqual({ type: 'leg', index: 0 });
});
