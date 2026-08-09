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
    for (const [icao, rec] of Object.entries(data.airfields)) {
      if (!airfieldByIcao(icao)) out.push('field ' + icao);
      for (const p of [...(rec.clockStartsAt || []), ...(rec.inside || [])]) {
        if (!navWP.some(w => w.name === p)) out.push(icao + ' -> ' + p);
      }
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

test('leaving a listed field always costs one leg, boundary point named or not', async ({ page }) => {
  await boot(page);
  // KNTRY is not one of LLHZ's named boundary points and not inside its CTR either: the
  // clock still starts there, because leaving the CTR is what starts the count.
  await route(page, ['LLHZ', 'KNTRY', 'HTZUK']);
  expect(await page.evaluate(() => ctrClockStartIndex())).toBe(1);
  expect(await page.evaluate(() => legBeforeCtrClock(0))).toBe(true);
  // LLIB -> AMNON: AMNON is INSIDE the CTR, so the clock has not started by then either.
  await route(page, ['LLIB', 'AMNON', 'TAVOR']);
  expect(await page.evaluate(() => ctrClockStartIndex())).toBe(2);
  expect(await page.evaluate(() => [0, 1].map(i => legBeforeCtrClock(i)))).toEqual([true, true]);
});

test('the exit point itself is still inside: the clock starts on the leg leaving it', async ({ page }) => {
  // LLHA -> GALIM -> DAROM: GALIM is inside the CTR and DAROM is the EXIT, so the leg
  // arriving at DAROM is still flown inside it. Counting starts on the leg that leaves.
  await boot(page);
  await route(page, ['LLHA', 'GALIM', 'DAROM', 'HOTRM']);
  expect(await page.evaluate(() => ctrClockStartIndex())).toBe(2);
  expect(await page.evaluate(() => [0, 1, 2].map(i => legBeforeCtrClock(i))))
    .toEqual([true, true, false]);
});

test('LLHA keeps the count off through KRYON, AFFEK and GILAM', async ({ page }) => {
  await boot(page);
  // All three are inside Haifa's CTR: the clock starts at DAROM, the first point outside.
  await route(page, ['LLHA', 'KRYON', 'GILAM', 'DAROM', 'HOTRM']);
  expect(await page.evaluate(() => ctrClockStartIndex())).toBe(3);
  expect(await page.evaluate(() => [0, 1, 2, 3].map(i => legBeforeCtrClock(i))))
    .toEqual([true, true, true, false]);
});

test('inside the CTR the kite and the drift cone are off by default', async ({ page }) => {
  await boot(page);
  await route(page, ['LLHZ', 'SFAIM', 'HTZUK']);
  const r = await page.evaluate(() => ({
    kite0: legKiteVisible(0, state.legs[0]),
    kite1: legKiteVisible(1, state.legs[1]),
    drift0: legDriftVisible(state.legs[0], true, 0),
    drift1: legDriftVisible(state.legs[1], true, 1),
  }));
  expect(r).toEqual({ kite0: false, kite1: true, drift0: false, drift1: true });
});

test('the inspector brings both back, and the choice round-trips', async ({ page }) => {
  await boot(page);
  await route(page, ['LLHZ', 'SFAIM', 'HTZUK']);
  await page.evaluate(() => { state.selected = { type: 'leg', index: 0 }; showInspector(); });
  const kiteBtn = page.locator('#insp-body .insp-btn', { hasText: /kite/i }).first();
  const driftBtn = page.locator('#insp-body .insp-btn', { hasText: /drift/i }).first();
  await expect(kiteBtn).toContainText(/Show kite/);
  await expect(driftBtn).toContainText(/Show drift/);
  await kiteBtn.click();
  await driftBtn.click();
  const on = await page.evaluate(() => ({
    kite: legKiteVisible(0, state.legs[0]),
    drift: legDriftVisible(state.legs[0], true, 0),
    saved: serializeRoute().legs[0],
  }));
  expect(on.kite).toBe(true);
  expect(on.drift).toBe(true);
  expect(on.saved.showKite).toBe(1);
  expect(on.saved.showDrift).toBe(1);
});

test('the plan shows --- for a CTR leg and leaves it out of the totals', async ({ page }) => {
  await boot(page);
  await route(page, ['LLHZ', 'SFAIM', 'HTZUK']);
  const r = await page.evaluate(() => {
    showFlightPlan();
    const cell = (row, key) => {
      const el = row.querySelector('[data-fp-col="' + key + '"]');
      return el ? el.textContent.trim() : null;
    };
    const rows = [...document.querySelectorAll('tbody tr')].filter(tr => cell(tr, 'time'));
    const foot = [...document.querySelectorAll('tfoot tr')].find(tr => cell(tr, 'time'));
    const { dist } = geo(state.waypoints[1], state.waypoints[2]);
    return {
      leg0: { time: cell(rows[0], 'time'), cum: cell(rows[0], 'cumTime') },
      leg1time: cell(rows[1], 'time'),
      total: cell(foot, 'time'),
      expected: toHMS(dist / state.legs[1].flightSpeed),
    };
  });
  // The CTR leg reads --- in both time columns...
  expect(r.leg0).toEqual({ time: '---', cum: '---' });
  // ...and the total is the second leg alone: the CTR leg contributes nothing.
  expect(r.leg1time).toBe(r.expected);
  expect(r.total).toBe(r.expected);
});

test('points inside the CTR are inherited from the corridors, not just listed', async ({ page }) => {
  await boot(page);
  // The published corridor from LLHA to its exits passes GALIM and GILAM; from LLIB it
  // passes AMNON; from LLBG, MRISN. None of that has to be written down twice.
  const derived = await page.evaluate(async () => {
    await loadCtrBoundaries();
    await fplLoadRouteGraph();
    await new Promise(r => setTimeout(r, 300));      // derivation is async
    const pick = (i) => (ctrBoundaries[i] && ctrBoundaries[i]._derived) || [];
    return { LLHA: pick('LLHA').sort(), LLIB: pick('LLIB'), LLBG: pick('LLBG') };
  });
  // The two the maintainer reported by hand, both derived without being listed:
  expect(derived.LLHA).toEqual(['GALIM', 'GILAM']);
  expect(derived.LLIB).toEqual(['AMNON']);
  // ...and a point nobody listed, on a field that is rare in CVFR practice: the derivation
  // is only as good as the graph there, which is why it is a HINT layered under the
  // hand-written list rather than a replacement for it.
  await route(page, ['LLIB', 'AMNON', 'TAVOR']);
  expect(await page.evaluate(() => ctrClockStartIndex())).toBe(2);
});
