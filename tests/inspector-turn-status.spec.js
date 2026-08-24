// @ts-check
// Reported: you cannot tell from the inspector that a point IS the turning point. The only
// sign was the action button drawn in bold while still reading "Mark as turning point" --
// which reads as an offer, not a state, so a marked point and an unmarked one looked alike
// unless you pressed one and watched what happened. The inspector now says it in words, and
// says where the turn came from: worked out from the route, or marked by hand.
const { test, expect } = require('./_setup');

// The turning-point action is only offered on a route that comes back to the airfield it
// left, so both fixtures start and end on a real one.
const OUT_AND_BACK = ['LLHZ', 'FAR', 'LLHZ'];
// A loop: comes home, but no leg retraces, so nothing in the geometry finds the turn.
const LOOP = ['LLHZ', 'FAR', 'SIDE', 'LLHZ'];

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showInspector === 'function' &&
    typeof setTurnWaypoint === 'function' &&
    Array.isArray(window.airfields) && window.airfields.length > 0);
}

const openWp = (page, codes, idx) => page.evaluate(([list, i]) => {
  const spread = { FAR: [0.30, 0.30], SIDE: [0.10, 0.50] };
  const home = airfields.find(a => a.name === 'LLHZ');
  state.waypoints = list.map((code) => {
    if (code === 'LLHZ') return { lat: home.lat, lng: home.lng, name: 'LLHZ' };
    const [dLat, dLng] = spread[code];
    return { lat: home.lat + dLat, lng: home.lng + dLng, name: code };
  });
  syncLegs();
  state.selected = { type: 'wp', index: i };
  showInspector();
}, [codes, idx]);

const turnUi = (page) => page.evaluate(() => {
  const status = document.getElementById('insp-turn-status');
  const btn = document.getElementById('insp-turn-btn');
  return {
    status: status ? status.textContent : null,
    label: btn ? btn.textContent : null,
    pressed: btn ? btn.getAttribute('aria-pressed') : null,
    title: btn ? btn.title : null,
  };
});

test('a proven turn is stated, and offers nothing to press', async ({ page }) => {
  await boot(page);
  await openWp(page, OUT_AND_BACK, 1);          // FAR: the leg after it retraces
  const ui = await turnUi(page);
  expect(ui.status).toMatch(/turning point/i);
  expect(ui.status).toMatch(/doubles back/i);   // and where the app got it from
  expect(ui.status).toMatch(/cannot be moved/i);
  // a-b-a turns at b and nowhere else, so there is no action: clearing it would leave a
  // route that visibly doubles back with no turn at all.
  expect(ui.label).toBeNull();
});

test('every other point on that route says where the turn is', async ({ page }) => {
  await boot(page);
  await openWp(page, ['LLHZ', 'FAR', 'LLHZ', 'SIDE', 'LLHZ'], 3);
  const ui = await turnUi(page);
  expect(ui.status).toMatch(/turns for home at FAR/i);
  expect(ui.label).toBeNull();                  // and offers no mark of its own
});

test('the proven turn cannot be moved or cleared from code either', async ({ page }) => {
  await boot(page);
  await openWp(page, OUT_AND_BACK, 1);
  const out = await page.evaluate(() => ({
    movedElsewhere: setTurnWaypoint(0),
    clearedItself: setTurnWaypoint(1),
    marks: state.waypoints.map(w => !!w.turn),
    turn: legRetraceTurnIndex(),
  }));
  expect(out.movedElsewhere).toBe(false);
  expect(out.clearedItself).toBe(false);
  expect(out.marks).toEqual([false, false, false]);
  expect(out.turn).toBe(1);                     // still the far point, whatever was asked
});

// A mark made while the route was a loop must not outrank the geometry once an edit makes
// the route double back -- the stored flag stays, but the proof decides.
test('proof outranks a mark left over from before', async ({ page }) => {
  await boot(page);
  await openWp(page, LOOP, 1);
  await page.click('#insp-turn-btn');           // mark FAR while nothing retraces
  const out = await page.evaluate(() => {
    const marked = legRetraceTurnIndex();
    // Edit SIDE away: LLHZ -> FAR -> LLHZ now doubles back at FAR... which happens to be
    // the marked point, so move the mark first to make the test mean something.
    setTurnWaypoint(1);                         // clear it
    state.waypoints[2] = { ...state.waypoints[0] };
    state.waypoints.length = 3;
    state.waypoints[0].turn = 1;                // a stale mark on the departure field
    syncLegs();
    return { marked, turn: legRetraceTurnIndex(), definitive: routeTurnIsDefinitive() };
  });
  expect(out.marked).toBe(1);                   // the mark decided while there was no proof
  expect(out.definitive).toBe(true);
  expect(out.turn).toBe(1);                     // proof decides now, not the stale mark
});

test('a point that is not the turn says nothing and offers the mark', async ({ page }) => {
  await boot(page);
  await openWp(page, LOOP, 2);                  // SIDE: nothing retraces anywhere
  const ui = await turnUi(page);
  expect(ui.status).toBeNull();                 // no state to report
  expect(ui.label).toMatch(/mark as/i);
  expect(ui.pressed).toBe('false');
});

test('a point marked by hand says so, and offers to clear', async ({ page }) => {
  await boot(page);
  await openWp(page, LOOP, 1);
  await page.click('#insp-turn-btn');
  const ui = await turnUi(page);
  expect(ui.status).toMatch(/you marked/i);     // by hand, not worked out
  expect(ui.label).toMatch(/clear/i);
  expect(ui.pressed).toBe('true');
  // ...and clearing it takes the line away again.
  await page.click('#insp-turn-btn');
  const after = await turnUi(page);
  expect(after.status).toBeNull();
  expect(after.label).toMatch(/mark as/i);
});

test('the status line reads in the panel language', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof showInspector === 'function' &&
    Array.isArray(window.airfields) && window.airfields.length > 0);
  await openWp(page, OUT_AND_BACK, 1);
  const status = await page.evaluate(() =>
    document.getElementById('insp-turn-status').textContent);
  expect(status).toMatch(/[֐-׿]/);    // Hebrew, not the English default
  expect(status).toContain('נקודת החזרה');
  // The panel's own vocabulary: a route "חוזר על עקבותיו", which is how every other
  // turning-point string in the Hebrew table says it.
  expect(status).toContain('עקבותיו');
});
