// @ts-check
// The climb-out from a field to its CTR boundary is flown on the field's procedure, not on
// the route's stopwatch: the cumulative clock starts at the boundary reporting point
// (docs/data/ctr-boundaries.json). Fields not listed behave as they always did.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const DATA = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'docs', 'data', 'ctr-boundaries.json'), 'utf8'));

async function boot(page) {
  await page.addInitScript(() => {
    try { for (const s of ['build', 'view', 'display']) localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof ctrClockStartIndex === 'function');
  await page.evaluate(async () => {
    await loadAirfields(); await loadNavWaypoints(); await loadCtrBoundaries();
  });
}

const route = (page, names) => page.evaluate((ns) => {
  const at = (n) => {
    const af = airfieldByIcao(n);
    if (af) return { lat: af.lat, lng: af.lng, name: n };
    const w = navWP.find(x => x.name === n);
    return { lat: w.lat, lng: w.lng, name: n };
  };
  state.waypoints = ns.map(at);
  syncLegs();
  for (const l of state.legs) l.flightSpeed = 90;
  draw();
}, names);

test('every listed field and boundary point exists in the datasets', async ({ page }) => {
  await boot(page);
  const bad = await page.evaluate((data) => {
    const out = [];
    for (const [icao, pts] of Object.entries(data.airfields)) {
      if (!airfieldByIcao(icao)) out.push('field ' + icao);
      for (const p of pts) if (!navWP.some(w => w.name === p)) out.push(icao + ' -> ' + p);
    }
    return out;
  }, DATA);
  expect(bad).toEqual([]);
});

test('the clock starts at the boundary point, not at the field', async ({ page }) => {
  await boot(page);
  // LLHZ -> SFAIM (its CTR boundary) -> HTZUK: leg 0 is inside the CTR.
  await route(page, ['LLHZ', 'SFAIM', 'HTZUK']);
  const r = await page.evaluate(() => ({
    start: ctrClockStartIndex(),
    leg0: legBeforeCtrClock(0),
    leg1: legBeforeCtrClock(1),
  }));
  expect(r).toEqual({ start: 1, leg0: true, leg1: false });
});

test('the cumulative time excludes the legs inside the CTR', async ({ page }) => {
  await boot(page);
  await route(page, ['LLHZ', 'SFAIM', 'HTZUK']);
  const shown = await page.evaluate(() => {
    window.showCumTime = true; window.showReturn = false;
    const real = window.drawCumTimeArrow;
    const out = [];
    window.drawCumTimeArrow = function (cx, cy, ang, t) { out.push(t); return real.apply(this, arguments); };
    draw();
    window.drawCumTimeArrow = real;
    // What the route BEYOND the boundary takes, computed the same way the renderer does.
    const { dist } = geo(state.waypoints[1], state.waypoints[2]);
    return { out, expected: toHMS(dist / state.legs[1].flightSpeed) };
  });
  // One cum kite (the CTR leg has none), reading the time from the boundary onwards.
  expect(shown.out).toEqual([shown.expected]);
});

test('a field with no boundary list is untouched, and so is a route that starts elsewhere', async ({ page }) => {
  await boot(page);
  // LLES is not in the list: the clock starts at the field, every leg counts.
  await route(page, ['LLES', 'SHARO', 'HADRA']);
  expect(await page.evaluate(() => ctrClockStartIndex())).toBe(0);
  // A route that starts at a plain reporting point is unaffected too.
  await route(page, ['SFAIM', 'HTZUK', 'NAGID']);
  expect(await page.evaluate(() => ctrClockStartIndex())).toBe(0);
});

test('a route that never reaches its boundary point keeps the old behaviour', async ({ page }) => {
  await boot(page);
  // Leaves LLHZ but flies to a point that is not one of its boundary points.
  await route(page, ['LLHZ', 'KNTRY', 'HTZUK']);
  expect(await page.evaluate(() => ctrClockStartIndex())).toBe(0);
  expect(await page.evaluate(() => legBeforeCtrClock(0))).toBe(false);
});
