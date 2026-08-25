// @ts-check
// Two ways a route mutated itself behind the lock.
//
// The lock exists because a position driving the map means the pilot is flying the route,
// and moving a waypoint out from under an in-progress leg is not an edit anyone asked for.
// Every deliberate edit path checks it -- the add-click, every waypoint drag, every note
// drag -- and the double-click leg split did not. Worse, the panel that would have shown
// what happened is itself suppressed in flight, so the route changed with nothing on screen
// to say so.
const { test, expect } = require('./_setup');
const { hideToolbarMenus } = require('./_toolbar');

// Same clean slate routes.spec.js uses: no stored preferences, every toolbar section open.
async function setupCleanInit(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_init_v1') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build', 'view', 'display', 'charts', 'export', 'print']) {
          localStorage.setItem('navaid.sec.' + s, '1');
        }
        localStorage.setItem('__test_init_v1', '1');
      }
    } catch (e) { /* private mode */ }
  });
}

const ROUTE = [
  { lat: 32.18, lng: 34.83, name: 'LLHZ' },
  { lat: 32.55, lng: 35.05, name: 'MID' },
  { lat: 32.80, lng: 35.20, name: 'LLHA' },
];

async function boot(page) {
  await setupCleanInit(page);
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof syncLegs === 'function');
  await page.evaluate((route) => {
    state.waypoints = route.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
    state.notes = [];
    state.selected = null;
    state.mode = null;
    syncLegs();
    map.setView([32.45, 35.0], 10);
    draw();
  }, ROUTE);
  await hideToolbarMenus(page);
}

// A point on a leg line and nothing else -- no waypoint, kite, label or note under it.
async function legPoint(page) {
  return page.evaluate(() => {
    for (let i = 0; i < state.legs.length; i++) {
      const a = proj(state.waypoints[i]);
      const b = proj(state.waypoints[i + 1]);
      for (const t of [0.4, 0.5, 0.6]) {
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        if (hitLeg(x, y) === i && hitNote(x, y) < 0 && !hitWaypointCandidates(x, y).length &&
            !hitCumLabel(x, y) && !hitCumLabelRet(x, y) && !hitLegLabel(x, y)) {
          const r = map.getContainer().getBoundingClientRect();
          return { x: Math.round(r.left + x), y: Math.round(r.top + y), legIndex: i,
                   waypoints: state.waypoints.length, legs: state.legs.length };
        }
      }
    }
    throw new Error('no leg-only point');
  });
}

test('a double-click cannot split a leg while the route is locked', async ({ page }) => {
  await boot(page);
  const pos = await legPoint(page);
  await page.evaluate(() => { window.editLocked = true; });
  await page.mouse.dblclick(pos.x, pos.y);
  const after = await page.evaluate(() => ({
    waypoints: state.waypoints.length, legs: state.legs.length, selected: state.selected,
  }));
  expect(after.waypoints).toBe(pos.waypoints);      // nothing inserted
  expect(after.legs).toBe(pos.legs);

  // ...and it is the lock, not the gesture: unlock and the same double-click splits.
  await page.evaluate(() => { window.editLocked = false; });
  await page.mouse.dblclick(pos.x, pos.y);
  expect(await page.evaluate(() => state.waypoints.length)).toBe(pos.waypoints + 1);
});

// The automatic half of the same lock: a fix driving the map locks the route without the
// pilot touching the switch, and that is exactly when this gesture was most dangerous --
// the inspector is suppressed in flight, so the split happened silently.
test('a double-click cannot split a leg while a position drives the map', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 3; };
    navigator.geolocation.clearWatch = () => {};
  });
  await boot(page);
  const pos = await legPoint(page);
  await page.evaluate(async () => {
    startLiveLocation();
    window.__geoCb({ coords: { latitude: 32.45, longitude: 35.0, accuracy: 5 }, timestamp: Date.now() });
    await new Promise(r => setTimeout(r, 400));
  });
  expect(await page.evaluate(() => routeEditLocked())).toBe(true);
  await page.mouse.dblclick(pos.x, pos.y);
  expect(await page.evaluate(() => state.waypoints.length)).toBe(pos.waypoints);
});

// Repaint coalescing: a drag used to call the full draw() on every pointer event, at up to
// 1000 Hz on a gaming mouse, and each one is a clear plus ~20 layer passes. scheduleDraw()
// already existed for exactly this (gps.js uses it); the drag paths did not.
test('a drag repaints once per frame, not once per pointer event', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    const wp = proj(state.waypoints[1]);
    const rect = map.getContainer().getBoundingClientRect();
    let draws = 0;
    const realDraw = window.draw;
    window.draw = function () { draws++; return realDraw.apply(this, arguments); };
    // Twenty moves inside one animation frame.
    map.getContainer().dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, clientX: rect.left + wp.x, clientY: rect.top + wp.y }));
    map.fire('mousedown', { latlng: map.containerPointToLatLng([wp.x, wp.y]),
      containerPoint: L.point(wp.x, wp.y),
      originalEvent: { clientX: rect.left + wp.x, clientY: rect.top + wp.y } });
    for (let i = 1; i <= 20; i++) {
      const x = wp.x + i * 2, y = wp.y + i * 2;
      map.fire('mousemove', { latlng: map.containerPointToLatLng([x, y]),
        containerPoint: L.point(x, y), originalEvent: { clientX: rect.left + x, clientY: rect.top + y } });
    }
    const duringSameFrame = draws;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const afterFrame = draws;
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    window.draw = realDraw;
    return { duringSameFrame, afterFrame, moved: state.waypoints[1].lat };
  });
  // Twenty moves, at most a couple of repaints -- and at least one, or nothing was drawn.
  expect(out.duringSameFrame).toBeLessThanOrEqual(2);
  expect(out.afterFrame).toBeGreaterThan(0);
  expect(out.afterFrame).toBeLessThanOrEqual(3);
});
