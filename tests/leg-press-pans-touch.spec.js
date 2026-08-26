// A leg press must let the map pan — on TOUCH as much as on mouse.
//
// The touchmove handler has said since it was written that a press on a leg line drags
// nothing and "the map pans under the finger instead". Only the mouse path was ever taught
// that. `legtap` is not a lockable kind, so holdMapForDrag() fell through to disabling the
// pan and the touch path then swallowed the gesture with preventDefault() — so on the
// kneeboard tablet the fix was written for, pressing anywhere on the route froze the chart.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof holdMapForDrag === 'function');
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.90, name: 'A' },
      { lat: 32.20, lng: 35.10, name: 'B' },
    ];
    if (typeof syncLegs === 'function') syncLegs();
    map.setView([32.10, 35.00], 11);
    draw();
  });
}

// Midway along the only leg, clear of either waypoint marker.
const legMidpoint = (page) => page.evaluate(() => {
  const a = state.waypoints[0], b = state.waypoints[1];
  return map.latLngToContainerPoint(L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2));
});

test('neither leg press kind takes the map', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => ['legtap', 'legclick'].map((k) => {
    map.dragging.enable();
    const took = holdMapForDrag(k);
    const enabled = map.dragging.enabled();
    map.dragging.enable();
    return { k, took, enabled };
  }));
  for (const g of got) {
    expect(g.took).toBe(false);
    expect(g.enabled).toBe(true);
  }
});

test('a one-finger press on a leg leaves the pan alone and is not swallowed', async ({ page }) => {
  await boot(page);
  const p = await legMidpoint(page);
  const got = await page.evaluate(({ x, y }) => {
    const el = document.getElementById('map');
    const r = el.getBoundingClientRect();
    const t = [{ clientX: r.left + x, clientY: r.top + y, identifier: 0 }];
    const ev = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'touches', { value: t });
    Object.defineProperty(ev, 'changedTouches', { value: t });
    el.dispatchEvent(ev);
    return { kind: touchDrag && touchDrag.kind, held: touchDrag && touchDrag.heldMap,
             dragEnabled: map.dragging.enabled(), swallowed: ev.defaultPrevented };
  }, p);
  expect(got.kind).toBe('legtap');
  expect(got.held).toBe(false);          // the press does not take the map...
  expect(got.dragEnabled).toBe(true);    // ...so Leaflet still pans
  expect(got.swallowed).toBe(false);     // ...and the gesture reaches it
});

// A pan that merely started on a leg is not a request to inspect that leg. The touch path
// restored the previous selection all along; the mouse path did not.
test('a mouse pan that started on a leg puts the selection back', async ({ page }) => {
  await boot(page);
  const p = await legMidpoint(page);
  const after = await page.evaluate(({ x, y }) => {
    state.selected = { type: 'wp', index: 0 };
    const el = map.getContainer();
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, clientX: r.left + x, clientY: r.top + y }));
    const onPress = JSON.stringify(state.selected);
    map.fire('movestart');                       // the chart moves under the press
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    map.dragging.enable();
    return { onPress, onRelease: JSON.stringify(state.selected) };
  }, p);
  expect(after.onPress).toBe('{"type":"leg","index":0}');
  expect(after.onRelease).toBe('{"type":"wp","index":0}');
});

// What actually stops a pinch that began on a waypoint from reading as a tap. There is no
// guard in touchmove for this: endTouch runs on EVERY touchend and clears touchDrag, so a
// drag cannot survive a pinch to be resumed. A guard added there fired only in the case it
// was not written for — killing a fresh drag for 700ms after any pinch.
test('a pinch that began on a waypoint is not a tap, and moves nothing', async ({ page }) => {
  await boot(page);
  const before = await page.evaluate(() => JSON.stringify(state.waypoints[0]));
  const got = await page.evaluate(() => {
    const el = document.getElementById('map');
    const r = el.getBoundingClientRect();
    const w = map.latLngToContainerPoint(
      L.latLng(state.waypoints[0].lat, state.waypoints[0].lng));
    const fire = (type, n) => {
      const t = Array.from({ length: n }, (_, i) => ({
        clientX: r.left + w.x + i * 40, clientY: r.top + w.y, identifier: i }));
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'touches', { value: t });
      Object.defineProperty(ev, 'changedTouches', { value: t.length ? t : [{
        clientX: r.left + w.x, clientY: r.top + w.y, identifier: 0 }] });
      el.dispatchEvent(ev);
    };
    fire('touchstart', 1);                     // press the waypoint
    fire('touchstart', 2);                     // ...second finger: a pinch
    fire('touchend', 1);                       // ...one lifts: endTouch clears touchDrag
    const cleared = touchDrag === null;
    fire('touchmove', 1);                      // nothing to resume, so nothing moves
    fire('touchend', 0);
    return { cleared, wp: JSON.stringify(state.waypoints[0]) };
  });
  expect(got.cleared).toBe(true);
  expect(got.wp).toBe(before);
});
