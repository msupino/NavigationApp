// @ts-check
// A track may be flown out and back -- once each way -- and no more. a-b-a is a sortie;
// a-b-a-b puts the same two legs on top of the two already drawn, and nothing on the chart
// separates the third pass from the first: same line, same kites, same numbers. The
// out-and-back split draws exactly one pair for that reason, so the builder holds the route
// to what the map can honestly show.
const { test, expect } = require('./_setup');

const A = { lat: 32.00, lng: 34.80, name: 'A' };
const B = { lat: 32.30, lng: 35.10, name: 'B' };
const C = { lat: 32.10, lng: 35.40, name: 'C' };

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function' &&
    typeof routeAllowsNextPoint === 'function');
}

const setRoute = (page, wps) => page.evaluate((list) => {
  state.waypoints = list.map(w => ({ ...w }));
  syncLegs();
  draw();
}, wps);

test('counts passes over a track whichever way each one is flown', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(([a, b, c]) => {
    const count = (wps) => trackPassCount(wps, a, b);
    return {
      once: count([a, b]),
      back: count([a, b, a]),
      thrice: count([a, b, a, b]),
      elsewhere: count([a, c, b]),      // a-c and c-b are different tracks
    };
  }, [A, B, C]);
  expect(out.once).toBe(1);
  expect(out.back).toBe(2);
  expect(out.thrice).toBe(3);
  expect(out.elsewhere).toBe(0);
});

test('out and back is allowed; the third pass is not', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(([a, b, c]) => ({
    outbound: routeAllowsNextPoint(b, [a]),
    back: routeAllowsNextPoint(a, [a, b]),
    again: routeAllowsNextPoint(b, [a, b, a]),        // a-b-a-b
    elsewhere: routeAllowsNextPoint(c, [a, b, a]),    // a-b-a-c is a different track
    firstPoint: routeAllowsNextPoint(a, []),
  }), [A, B, C]);
  expect(out.outbound).toBe(true);
  expect(out.back).toBe(true);
  expect(out.again).toBe(false);
  expect(out.elsewhere).toBe(true);
  expect(out.firstPoint).toBe(true);
});

test('a route that already flies a track twice is reported by the vetting helper', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(([a, b, c]) => ({
    fine: routeOverflownTrack([a, b, a, c]),
    over: routeOverflownTrack([a, b, a, b]),
    // Two legs between the same pair of points that are NOT adjacent still count: the
    // route leaves and comes back to fly the same track a third time.
    scattered: routeOverflownTrack([a, b, c, b, a, b]),
  }), [A, B, C]);
  expect(out.fine).toBeNull();
  expect(out.over).not.toBeNull();
  expect(out.over.i).toBe(0);            // reported at the first leg over that track
  expect(out.scattered).not.toBeNull();
});

test('tapping between two points stops at the return, with a reason', async ({ page }) => {
  await boot(page);
  await setRoute(page, [A, B, A]);
  const out = await page.evaluate((b) => {
    let toasted = '';
    const realToast = window.showToast;
    window.showToast = (m) => { toasted = m; };
    state.mode = 'add';
    // Tap B again: it is already on the route, so this goes through the extend-through path.
    const at = state.waypoints.findIndex(w => w.name === 'B');
    const handled = addModeExtendThroughWaypoint(at);
    window.showToast = realToast;
    return { handled, toasted, len: state.waypoints.length };
  }, B);
  expect(out.len).toBe(3);                      // the tap added nothing
  expect(out.handled).toBe(true);               // and it was not passed on as a map click
  expect(out.toasted).toMatch(/out and back/i);
});

test('a fourth point elsewhere is still welcome', async ({ page }) => {
  await boot(page);
  await setRoute(page, [A, B, A]);
  const len = await page.evaluate((c) => {
    state.waypoints.push({ ...c });
    syncLegs();
    return state.waypoints.length;
  }, C);
  expect(len).toBe(4);
  expect(await page.evaluate(() => routeOverflownTrack(state.waypoints))).toBeNull();
});

// The inspector's "Add to route" needs no guard of its own: a leg that would fly a track a
// third time always ends on a point the route already contains, and that button has always
// refused those. This pins the reasoning -- if the already-on-route rule is ever relaxed,
// this test fails and the guard has to come back.
test('the inspector never offers an add that would be the third pass', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    await loadNavWaypoints();
    const hz = airfieldByIcao('LLHZ');
    const ridng = navWP.find(w => w.name === 'RIDNG');
    state.waypoints = [
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      { lat: ridng.lat, lng: ridng.lng, name: 'RIDNG' },
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
    ];
    syncLegs();
    state.selected = { type: 'navwp', index: navWP.indexOf(ridng) };
    showInspector();
    const btn = document.getElementById('insp-add-to-route');
    const before = state.waypoints.length;
    if (btn) btn.click();
    return btn ? { disabled: btn.disabled, grew: state.waypoints.length - before } : null;
  });
  expect(out).not.toBeNull();
  expect(out.disabled).toBe(true);
  expect(out.grew).toBe(0);
});

test('a typed route asking for three passes is refused before it replaces the map', async ({ page }) => {
  await boot(page);
  await setRoute(page, [A, C]);
  const out = await page.evaluate(async () => {
    let alerted = '';
    const realAlert = window.alert;
    window.alert = (m) => { alerted = m; };
    const ok = await buildRouteFromQuery('LLHZ RIDNG LLHZ RIDNG');
    window.alert = realAlert;
    return { ok, alerted, names: state.waypoints.map(w => w.name) };
  });
  expect(out.ok).toBe(false);
  expect(out.alerted).toMatch(/twice|out and back/i);
  expect(out.names).toEqual(['A', 'C']);        // the route on the map is untouched
});

test('a typed out-and-back still builds', async ({ page }) => {
  await boot(page);
  const names = await page.evaluate(async () => {
    window.confirm = () => true;
    window.autoRouteCorridors = false;          // direct legs only, so the codes are the route
    await buildRouteFromQuery('LLHZ RIDNG LLHZ');
    return state.waypoints.map(w => w.name);
  });
  expect(names).toEqual(['LLHZ', 'RIDNG', 'LLHZ']);
});
