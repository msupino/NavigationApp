// @ts-check
// A route turns for home once, so one leg -- one, in the whole route -- is flown out and
// back. a-b-a is that sortie. a-b-a-b flies the same track a third time and a-b-a-c-a
// doubles back twice; in both cases the extra pass lands on a line already drawn, with the
// same kites and the same numbers on top of it. The out-and-back split draws exactly one
// pair for that reason, so the builder holds the route to what the map can honestly show.
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

test('one out-and-back is allowed; a second doubling back is not', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(([a, b, c]) => ({
    outbound: routeAllowsNextPoint(b, [a]),
    back: routeAllowsNextPoint(a, [a, b]),            // a-b-a: the turn for home
    again: routeAllowsNextPoint(b, [a, b, a]),        // a-b-a-b: the same track a third time
    onward: routeAllowsNextPoint(c, [a, b, a]),       // a-b-a-c: still one repeat
    secondTurn: routeAllowsNextPoint(a, [a, b, a, c]),  // a-b-a-c-a: doubles back twice
    firstPoint: routeAllowsNextPoint(a, []),
  }), [A, B, C]);
  expect(out.outbound).toBe(true);
  expect(out.back).toBe(true);
  expect(out.again).toBe(false);
  expect(out.onward).toBe(true);
  expect(out.secondTurn).toBe(false);
  expect(out.firstPoint).toBe(true);
});

test('the vetting helper reports the leg that puts a route over the limit', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(([a, b, c]) => ({
    fine: routeOverflownTrack([a, b, a, c]),          // one repeat: the turn for home
    thirdPass: routeOverflownTrack([a, b, a, b]),
    secondTurn: routeOverflownTrack([a, b, a, c, a]), // two different tracks doubled back
    // A repeat need not be adjacent to the leg it repeats: the route can wander away and
    // come back to fly the same track again.
    scattered: routeOverflownTrack([a, b, c, b, a, b]),
    repeats: routeRepeatedLegs([a, b, a, c, a]),
  }), [A, B, C]);
  expect(out.fine).toBeNull();
  expect(out.thirdPass).not.toBeNull();
  expect(out.thirdPass.i).toBe(2);       // the leg past the allowance, not the first repeat
  expect(out.secondTurn).not.toBeNull();
  expect(out.secondTurn.i).toBe(3);
  expect(out.scattered).not.toBeNull();
  expect(out.repeats).toEqual([1, 3]);   // both doublings back, in route order
});

test('tapping between two points stops at the turn for home, with a reason', async ({ page }) => {
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
  expect(out.toasted).toMatch(/doubles back once/i);
});

test('carrying on to a new point after the turn is still welcome', async ({ page }) => {
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
test('the inspector never offers an add that would double the route back again', async ({ page }) => {
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
  expect(out.alerted).toMatch(/doubles back once/i);
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
