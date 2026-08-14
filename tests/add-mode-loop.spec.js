// @ts-check
// In add mode, pressing an existing waypoint EXTENDS the route through that point rather than
// opening its inspector — which is how a loop is drawn: press the point you want to come back
// to. A drag still repositions, so the point you just placed can be nudged without leaving the
// mode.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function' && typeof map !== 'undefined' &&
    typeof state !== 'undefined' && typeof setMode === 'function' &&
    typeof airfieldByIcao === 'function' && Array.isArray(airfields) && airfields.length > 0);
}

async function route(page) {
  return page.evaluate(() => {
    const hz = airfieldByIcao('LLHZ');
    state.waypoints = [
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      { lat: hz.lat + 0.06, lng: hz.lng + 0.04, name: 'ONE' },
      { lat: hz.lat + 0.11, lng: hz.lng + 0.01, name: 'TWO' },
    ];
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 90;
    map.setView([hz.lat + 0.055, hz.lng + 0.02], 11);
    draw();
    return state.waypoints.length;
  });
}

// Press and release on waypoint `i` without moving, through the real handlers.
async function pressWaypoint(page, i) {
  return page.evaluate(idx => {
    const wp = state.waypoints[idx];
    const p = map.latLngToContainerPoint([wp.lat, wp.lng]);
    map.fire('mousedown', { containerPoint: L.point(p.x, p.y),
      latlng: L.latLng(wp.lat, wp.lng) });
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    map.fire('click', { containerPoint: L.point(p.x, p.y), latlng: L.latLng(wp.lat, wp.lng) });
    return { count: state.waypoints.length, names: state.waypoints.map(w => w.name),
      legs: state.legs.length,
      inspectorOpen: !document.getElementById('inspector').classList.contains('hidden'),
      selected: JSON.parse(JSON.stringify(state.selected || null)) };
  }, i);
}

test('in add mode, pressing the first waypoint closes the loop', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => setMode('add'));
  const after = await pressWaypoint(page, 0);
  // A fourth waypoint at LLHZ's position: the route now leaves and returns to the field.
  expect(after.count).toBe(4);
  expect(after.legs).toBe(3);
  expect(after.names).toEqual(['LLHZ', 'ONE', 'TWO', 'LLHZ']);
  const closed = await page.evaluate(() =>
    sameMapPoint(state.waypoints[0], state.waypoints[state.waypoints.length - 1]));
  expect(closed).toBe(true);
  // The inspector must NOT open — that was the old behaviour and it blocked this gesture.
  expect(after.inspectorOpen).toBe(false);
  // The new waypoint is what is selected, so the next press continues from there.
  expect(after.selected).toEqual({ type: 'wp', index: 3 });
});

test('an unnamed closed loop reuses WP1 on the map and in the flight plan', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.0, lng: 34.8, name: '' },
      { lat: 32.1, lng: 34.9, name: '' },
      { lat: 32.2, lng: 34.85, name: '' },
    ];
    syncLegs();
    map.fitBounds(state.waypoints.map(w => [w.lat, w.lng]));
    draw();
    setMode('add');
  });
  await pressWaypoint(page, 0);

  const labels = await page.evaluate(() => state.waypoints.map((_, i) => wpLabel(i)));
  expect(labels).toEqual(['WP 1', 'WP 2', 'WP 3', 'WP 1']);
  expect(await page.evaluate(() => legPairTitle(2))).toBe('WP 3 → WP 1');
  expect(await page.evaluate(() => {
    state.waypoints[0].name = 'HOME';
    const tail = wpLabel(3);
    state.waypoints[0].name = '';
    return tail;
  })).toBe('HOME');

  await page.evaluate(() => {
    setMode(null);
    const wp = state.waypoints[0];
    const p = map.latLngToContainerPoint([wp.lat, wp.lng]);
    map.fire('mousedown', { containerPoint: L.point(p.x, p.y), latlng: L.latLng(wp.lat, wp.lng) });
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    showFlightPlan();
  });
  await expect(page.locator('#insp-title')).toHaveValue('WP 1');
  const placeholders = await page.locator('.plan-name').evaluateAll(inputs =>
    inputs.map(input => input.placeholder));
  expect(placeholders).toEqual(['WP 1', 'WP 2', 'WP 2', 'WP 3', 'WP 3', 'WP 1']);
});

test('pressing a middle waypoint routes through it again', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => setMode('add'));
  const after = await pressWaypoint(page, 1);
  expect(after.names).toEqual(['LLHZ', 'ONE', 'TWO', 'ONE']);
  expect(after.legs).toBe(3);
});

test('pressing the LAST waypoint does nothing — that would be a zero-length leg', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => setMode('add'));
  const after = await pressWaypoint(page, 2);
  // #104's rule: repeating the point the next leg would start from is the one case that makes
  // a leg of no length. It stays a no-op rather than becoming a duplicate.
  expect(after.count).toBe(3);
  expect(after.legs).toBe(2);
});

test('outside add mode, pressing a waypoint still opens its inspector', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => setMode(null));
  const after = await pressWaypoint(page, 0);
  expect(after.count).toBe(3);                 // nothing added
  expect(after.inspectorOpen).toBe(true);      // the normal selection gesture is unchanged
  expect(after.selected).toEqual({ type: 'wp', index: 0 });
});

test('in add mode a DRAG still repositions the waypoint', async ({ page }) => {
  await boot(page);
  await route(page);
  const moved = await page.evaluate(() => {
    setMode('add');
    const wp = state.waypoints[1];
    const before = { lat: wp.lat, lng: wp.lng };
    const p = map.latLngToContainerPoint([wp.lat, wp.lng]);
    map.fire('mousedown', { containerPoint: L.point(p.x, p.y),
      latlng: L.latLng(wp.lat, wp.lng) });
    const to = map.containerPointToLatLng([p.x + 70, p.y + 70]);
    map.fire('mousemove', { containerPoint: L.point(p.x + 70, p.y + 70), latlng: to });
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return { count: state.waypoints.length,
      movedAway: Math.abs(state.waypoints[1].lat - before.lat) > 0.001 ||
                 Math.abs(state.waypoints[1].lng - before.lng) > 0.001 };
  });
  // The press-to-extend gesture must not cost the ability to nudge the point just placed.
  expect(moved.count).toBe(3);
  expect(moved.movedAway).toBe(true);
});

test('a closed loop files as a flight plan, field to field', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => setMode('add'));
  await pressWaypoint(page, 0);
  const res = await page.evaluate(() => {
    for (const l of state.legs) l.flightSpeed = 90;
    return buildIcaoFpl({ reg: 'HLH', type: 'C172', wake: 'L', equip: 'S', surv: 'C',
      pic: 'A PILOT', license: '1', cell: '0500000000', persons: '2', endurance: '0500',
      replyTo: 'pilot@example.com', kind: 'routes' },
    { dateLocal: '2026-08-05', timeLocal: '09:20' });
  });
  expect(res.errs).toBeUndefined();
  expect(res.dep).toBe('LLHZ');
  expect(res.dest).toBe('LLHZ');
});

// --- the point a loop visits twice ------------------------------------------------
async function closedLoop(page) {
  return page.evaluate(() => {
    const hz = airfieldByIcao('LLHZ');
    state.waypoints = [
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      { lat: hz.lat + 0.06, lng: hz.lng + 0.04, name: 'ONE' },
      { lat: hz.lat + 0.11, lng: hz.lng + 0.01, name: 'TWO' },
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
    ];
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 90;
    map.setView([hz.lat + 0.055, hz.lng + 0.02], 11);
    draw();
    return state.waypoints.length;
  });
}

test('the shared point of a loop can be dragged, and the loop stays closed', async ({ page }) => {
  await boot(page);
  await closedLoop(page);
  const r = await page.evaluate(() => {
    setMode(null);
    const wp = state.waypoints[0];
    const before = { lat: wp.lat, lng: wp.lng };
    const p = map.latLngToContainerPoint([wp.lat, wp.lng]);
    map.fire('mousedown', { containerPoint: L.point(p.x, p.y), latlng: L.latLng(wp.lat, wp.lng) });
    const armed = { drag: !!drag, also: drag ? drag.also : null,
      chooser: document.querySelectorAll('.point-choice-option').length };
    const to = map.containerPointToLatLng([p.x + 80, p.y + 40]);
    map.fire('mousemove', { containerPoint: L.point(p.x + 80, p.y + 40), latlng: to });
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return { armed, count: state.waypoints.length,
      closed: sameMapPoint(state.waypoints[0], state.waypoints[3]),
      moved: Math.abs(state.waypoints[0].lat - before.lat) > 0.001 ||
             Math.abs(state.waypoints[0].lng - before.lng) > 0.001 };
  });
  // Two waypoints at one place gave the chooser two identical options AND consumed the press,
  // so the shared point of a closed route could not be moved at all.
  expect(r.armed.chooser).toBe(0);
  expect(r.armed.drag).toBe(true);
  expect(r.armed.also).toEqual([0]);
  expect(r.moved).toBe(true);
  expect(r.count).toBe(4);
  // Both visits move together: dragging one end of a loop must not tear it open.
  expect(r.closed).toBe(true);
});

test('cancelling a drag of the shared point restores both ends', async ({ page }) => {
  await boot(page);
  await closedLoop(page);
  const r = await page.evaluate(() => {
    setMode(null);
    map.setView([state.waypoints[0].lat, state.waypoints[0].lng], 15);   // ~4 m/px
    draw();
    const wp = state.waypoints[0];
    const before = { lat: wp.lat, lng: wp.lng };
    const p = map.latLngToContainerPoint([wp.lat, wp.lng]);
    map.fire('mousedown', { containerPoint: L.point(p.x, p.y), latlng: L.latLng(wp.lat, wp.lng) });
    // A nudge inside the arming distance, i.e. picked up and put back: a cancel.
    map.fire('mousemove', { containerPoint: L.point(p.x + 2, p.y + 1),
      latlng: map.containerPointToLatLng([p.x + 2, p.y + 1]) });
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return { closed: sameMapPoint(state.waypoints[0], state.waypoints[3]),
      backAtStart: state.waypoints[0].lat === before.lat && state.waypoints[0].lng === before.lng,
      tailMatches: state.waypoints[3].lat === before.lat && state.waypoints[3].lng === before.lng };
  });
  expect(r.backAtStart).toBe(true);
  expect(r.tailMatches).toBe(true);       // the carried end came back too
  expect(r.closed).toBe(true);
});

test('two DIFFERENT waypoints under one press still offer the chooser', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    // 1 m apart with different names: well inside sameMapPoint's ~22 m tolerance, yet two real
    // waypoints. Collapsing on sameMapPoint alone made this pair undecidable (routes.spec.js
    // 'close route waypoints ask which point to select instead of changing zoom').
    state.waypoints = [
      { lat: 32.2, lng: 34.9, name: 'FIRST' },
      { lat: 32.20001, lng: 34.90001, name: 'SECOND' },
    ];
    syncLegs();
    map.setView([32.2, 34.9], 12);
    draw();
  });
  const r = await page.evaluate(() => {
    setMode(null);
    const wp = state.waypoints[0];
    const p = map.latLngToContainerPoint([wp.lat, wp.lng]);
    map.fire('mousedown', { containerPoint: L.point(p.x, p.y), latlng: L.latLng(wp.lat, wp.lng) });
    return { hits: hitWaypointCandidates(p.x, p.y).length,
      chooser: document.querySelectorAll('.point-choice-option').length,
      sameByTolerance: sameMapPoint(state.waypoints[0], state.waypoints[1]) };
  });
  expect(r.hits).toBe(2);
  expect(r.sameByTolerance).toBe(true);      // the tolerance really does call them one point
  expect(r.chooser).toBe(2);                 // ...and the chooser is offered anyway
});
