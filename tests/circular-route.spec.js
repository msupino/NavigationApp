// @ts-check
// A route may close back onto its own first waypoint — the local sortie that leaves an
// airfield and returns to it.
//
// Two paths build one: clicking the departure marker again in add mode, and dragging the last
// waypoint onto the first. Both used to refuse it, because both guard "no two waypoints at one
// point" (a zero-length leg, issue #104) by testing EVERY waypoint instead of the adjacent
// one. Only an ADJACENT duplicate makes a zero-length leg; a non-adjacent one is a route that
// passes a point twice, which is ordinary. Dragging a waypoint onto its NEIGHBOUR still
// deletes it — that gesture is deliberate — so the tests below pin both halves.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  // `state` and `map` are const/let at script top level, so they are NOT window properties --
  // typeof is the only way to see them from here.
  await page.waitForFunction(() => typeof syncLegs === 'function' &&
    typeof map !== 'undefined' && typeof state !== 'undefined' &&
    typeof airfieldByIcao === 'function' && Array.isArray(airfields) && airfields.length > 0);
}

// Three waypoints out of an airfield, so index 0 and index 2 are not adjacent.
async function outbound(page) {
  return page.evaluate(() => {
    const hz = airfieldByIcao('LLHZ');
    state.waypoints = [
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      { lat: hz.lat + 0.05, lng: hz.lng + 0.03, name: 'ONE' },
      { lat: hz.lat + 0.10, lng: hz.lng + 0.01, name: 'TWO' },
    ];
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 90;
    map.setView([hz.lat + 0.05, hz.lng + 0.02], 12);
    draw();
    return state.waypoints.length;
  });
}

// Drag waypoint `i` onto waypoint `onto`, through the real handlers: mousedown on the marker,
// mousemove to the target, then the window mouseup endMouseDrag listens on.
async function dragOnto(page, i, onto) {
  return page.evaluate(([i, onto]) => {
    const from = state.waypoints[i];
    const to = state.waypoints[onto];
    const pFrom = map.latLngToContainerPoint([from.lat, from.lng]);
    const pTo = map.latLngToContainerPoint([to.lat, to.lng]);
    map.fire('mousedown', { containerPoint: L.point(pFrom.x, pFrom.y),
      latlng: L.latLng(from.lat, from.lng) });
    // A first move well clear of the origin, so the drag is armed and the drop is not read as
    // "put back where it started".
    map.fire('mousemove', { containerPoint: L.point(pFrom.x + 60, pFrom.y + 60),
      latlng: map.containerPointToLatLng([pFrom.x + 60, pFrom.y + 60]) });
    map.fire('mousemove', { containerPoint: L.point(pTo.x, pTo.y),
      latlng: L.latLng(to.lat, to.lng) });
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return { count: state.waypoints.length, names: state.waypoints.map(w => w.name),
      legs: state.legs.length };
  }, [i, onto]);
}

test('the last waypoint can be dragged onto the first, closing the route', async ({ page }) => {
  await boot(page);
  await outbound(page);
  const after = await dragOnto(page, 2, 0);
  // Kept, not deleted: index 2 and index 0 are not neighbours, so there is no zero-length leg
  // to prevent -- this is a round trip.
  expect(after.count).toBe(3);
  expect(after.legs).toBe(2);
  const ends = await page.evaluate(() => {
    const a = state.waypoints[0], b = state.waypoints[state.waypoints.length - 1];
    return { same: sameMapPoint(a, b), first: a.name, last: b.name };
  });
  expect(ends.same).toBe(true);
  expect(ends.first).toBe('LLHZ');
  expect(ends.last).toBe('LLHZ');       // it took the point's name, as any snap does
});

test('dragging a waypoint onto its neighbour still deletes it', async ({ page }) => {
  await boot(page);
  await outbound(page);
  // The deliberate gesture: drop a waypoint on the one next to it and it goes away, with the
  // adjacent leg. Adjacent is also the only case that would leave a zero-length leg.
  const after = await dragOnto(page, 1, 0);
  expect(after.count).toBe(2);
  expect(after.names).toEqual(['LLHZ', 'TWO']);
  expect(after.legs).toBe(1);
});

test('the first waypoint can be dragged onto the last', async ({ page }) => {
  await boot(page);
  await outbound(page);
  const after = await dragOnto(page, 0, 2);
  expect(after.count).toBe(3);
  expect(await page.evaluate(() => sameMapPoint(state.waypoints[0], state.waypoints[2])))
    .toBe(true);
});

test('a nudge that lands back where it started is a cancel, not a delete', async ({ page }) => {
  await boot(page);
  await outbound(page);
  const after = await page.evaluate(() => {
    map.setView([state.waypoints[1].lat, state.waypoints[1].lng], 15);   // ~4 m/px
    draw();
    const wp = state.waypoints[1];
    const p = map.latLngToContainerPoint([wp.lat, wp.lng]);
    map.fire('mousedown', { containerPoint: L.point(p.x, p.y),
      latlng: L.latLng(wp.lat, wp.lng) });
    // Two pixels and release -- inside the 18px arming distance, so the waypoint is still
    // within ~22 m of where it started. This deleted it.
    map.fire('mousemove', { containerPoint: L.point(p.x + 2, p.y + 1),
      latlng: map.containerPointToLatLng([p.x + 2, p.y + 1]) });
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return { count: state.waypoints.length, names: state.waypoints.map(w => w.name) };
  });
  expect(after.count).toBe(3);
  expect(after.names).toEqual(['LLHZ', 'ONE', 'TWO']);
});

test('add mode closes the route when the departure point is clicked again', async ({ page }) => {
  await boot(page);
  await outbound(page);
  const after = await page.evaluate(() => {
    setMode('add');
    const first = state.waypoints[0];
    map.fire('click', { latlng: L.latLng(first.lat, first.lng) });
    return { count: state.waypoints.length,
      lastSameAsFirst: sameMapPoint(state.waypoints[0],
        state.waypoints[state.waypoints.length - 1]),
      lastName: state.waypoints[state.waypoints.length - 1].name };
  });
  expect(after.count).toBe(4);
  expect(after.lastSameAsFirst).toBe(true);
  expect(after.lastName).toBe('LLHZ');
});

test('add mode still refuses the point the next leg would start from', async ({ page }) => {
  await boot(page);
  await outbound(page);
  const after = await page.evaluate(() => {
    setMode('add');
    const last = state.waypoints[state.waypoints.length - 1];
    map.fire('click', { latlng: L.latLng(last.lat, last.lng) });
    return state.waypoints.length;
  });
  // The one case that really would produce a zero-length leg (issue #104).
  expect(after).toBe(3);
});

test('a closed route still builds a flight plan, field to field', async ({ page }) => {
  await boot(page);
  await outbound(page);
  await dragOnto(page, 2, 0);
  const res = await page.evaluate(() => {
    for (const l of state.legs) l.flightSpeed = 90;
    return buildIcaoFpl({ reg: 'HLH', type: 'C172', wake: 'L', equip: 'S', surv: 'C',
      pic: 'A PILOT', license: '1', cell: '0500000000', persons: '2', endurance: '0500',
      replyTo: 'pilot@example.com', kind: 'routes' },
    { dateLocal: '2026-08-05', timeLocal: '09:20' });
  });
  // Departure and destination are the same field, which is what a local sortie is. The
  // mid-route refusal must not fire: ONE is a plain waypoint, and the endpoints are endpoints.
  expect(res.errs).toBeUndefined();
  expect(res.dep).toBe('LLHZ');
  expect(res.dest).toBe('LLHZ');
});
