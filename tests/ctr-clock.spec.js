// @ts-check
// A leg flown inside a CTR -- the departure field's on the way out, the destination's on
// the way in -- is flown on the field's procedure, not on the route's stopwatch: no time,
// no cumulative time, no kite, no drift cone. Membership is by NAME only
// (docs/data/ctr-boundaries.json plus what the corridors imply); nothing is inferred from a
// leg's position in the route.
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
  await page.waitForFunction(() => typeof legInsideCtr === 'function');
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

test('a leg between the field and its exit point is inside the CTR', async ({ page }) => {
  await boot(page);
  await route(page, ['LLHZ', 'SFAIM', 'HTZUK']);
  expect(await page.evaluate(() => [0, 1].map(i => legInsideCtr(i)))).toEqual([true, false]);
});

test('membership is by name: a point the CTR does not name is ordinary route time', async ({ page }) => {
  await boot(page);
  // KNTRY belongs to HERZLIYA's boundary, not Haifa's: arriving at LLHA through it is
  // ordinary route time the whole way.
  await route(page, ['HTZUK', 'KNTRY', 'LLHA']);
  expect(await page.evaluate(() => [0, 1].map(i => legInsideCtr(i)))).toEqual([false, false]);
});

test('the arrival boundary works like the departure one: KNTRY into LLHZ is inside', async ({ page }) => {
  await boot(page);
  // Home via the one-way KNTRY corridor: HTZUK -> KNTRY still counts (HTZUK is outside),
  // KNTRY -> LLHZ is flown inside the CTR -- no kite, no cumulative time.
  await route(page, ['HTZUK', 'KNTRY', 'LLHZ']);
  const r = await page.evaluate(() => ({
    inside: [0, 1].map(i => legInsideCtr(i)),
    kite1: legKiteVisible(1, state.legs[1]),
    drift1: legDriftVisible(state.legs[1], true, 1),
  }));
  expect(r.inside).toEqual([false, true]);
  expect(r.kite1).toBe(false);
  expect(r.drift1).toBe(false);
});

test('the exit point is inside: the clock starts on the leg that leaves it', async ({ page }) => {
  await boot(page);
  // LLHA -> GALIM -> DAROM: GALIM is inside (inherited from the corridor) and DAROM is the
  // exit, so both legs are inside; counting starts on the leg out of DAROM.
  await route(page, ['LLHA', 'GALIM', 'DAROM', 'HOTRM']);
  expect(await page.evaluate(() => [0, 1, 2].map(i => legInsideCtr(i))))
    .toEqual([true, true, false]);
});

test('LLIB keeps the count off to AMNON, inside its CTR', async ({ page }) => {
  await boot(page);
  await route(page, ['LLIB', 'AMNON', 'TAVOR']);
  expect(await page.evaluate(() => [0, 1].map(i => legInsideCtr(i)))).toEqual([true, false]);
});

test('a field with no CTR data, and a route between plain points, are untouched', async ({ page }) => {
  await boot(page);
  await route(page, ['LLES', 'SHARO', 'HADRA']);
  expect(await page.evaluate(() => [0, 1].map(i => legInsideCtr(i)))).toEqual([false, false]);
  await route(page, ['SFAIM', 'HTZUK', 'NAGID']);
  expect(await page.evaluate(() => [0, 1].map(i => legInsideCtr(i)))).toEqual([false, false]);
});

test('points inside the CTR are inherited from the corridors, not just listed', async ({ page }) => {
  await boot(page);
  // The derivation is kicked off by first USE, not at boot: a route that touches a listed
  // field is what starts it, and the answer lands a repaint later.
  await route(page, ['LLHZ', 'SFAIM', 'HTZUK']);
  await page.evaluate(() => legInsideCtr(0));
  await page.waitForFunction(
    () => ctrBoundaries && ctrBoundaries.LLHA && (ctrBoundaries.LLHA._derived || []).length > 0,
    { timeout: 8000 });
  const derived = await page.evaluate(() => {
    const pick = (i) => (ctrBoundaries[i] && ctrBoundaries[i]._derived) || [];
    return { LLHA: pick('LLHA').sort(), LLIB: pick('LLIB') };
  });
  // Both corrections the maintainer had to report by hand fall out of the graph.
  expect(derived.LLHA).toEqual(['GALIM', 'GILAM']);
  expect(derived.LLIB).toEqual(['AMNON']);
});

test('inside the CTR the kite and the drift cone are off by default', async ({ page }) => {
  await boot(page);
  await route(page, ['LLHZ', 'SFAIM', 'HTZUK']);
  expect(await page.evaluate(() => ({
    kite0: legKiteVisible(0, state.legs[0]),
    kite1: legKiteVisible(1, state.legs[1]),
    drift0: legDriftVisible(state.legs[0], true, 0),
    drift1: legDriftVisible(state.legs[1], true, 1),
  }))).toEqual({ kite0: false, kite1: true, drift0: false, drift1: true });
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

test('an out-and-back is quiet at both ends and counted in the middle', async ({ page }) => {
  await boot(page);
  await route(page, ['LLHZ', 'SFAIM', 'HTZUK', 'KNTRY', 'LLHZ']);
  const r = await page.evaluate(() => {
    showFlightPlan();
    const cell = (row, k) => {
      const el = row.querySelector('[data-fp-col="' + k + '"]');
      return el ? el.textContent.trim() : null;
    };
    const rows = [...document.querySelectorAll('tbody tr')].filter(tr => cell(tr, 'time'));
    const foot = [...document.querySelectorAll('tfoot tr')].find(tr => cell(tr, 'time'));
    return { inside: state.legs.map((_, i) => legInsideCtr(i)),
      times: rows.map(tr => cell(tr, 'time')), total: cell(foot, 'time') };
  });
  // Out through SFAIM, home through KNTRY -- both boundary points, so the first and last
  // legs are quiet and the middle of the sortie is what the clock measures.
  expect(r.inside).toEqual([true, false, false, true]);
  expect(r.times[0]).toBe('---');
  expect(r.times[3]).toBe('---');
  expect(r.total).not.toBe('--');
});

test('deleting a middle waypoint recomputes the cumulative column correctly', async ({ page }) => {
  // The maintainer's check: a mid-route deletion merges two legs into one -- the later
  // cumulative times must be the running totals of the NEW legs, not stale cells from the
  // old indices, and the CTR gating must re-evaluate against the new route.
  await boot(page);
  await route(page, ['LLHZ', 'SFAIM', 'HTZUK', 'NAGID']);
  const read = () => page.evaluate(() => {
    showFlightPlan();
    const cell = (row, k) => {
      const el = row.querySelector('[data-fp-col="' + k + '"]');
      return el ? el.textContent.trim() : null;
    };
    const rows = [...document.querySelectorAll('tbody tr')].filter(tr => cell(tr, 'time'));
    // Expected running totals from the same primitives the renderer uses.
    let cum = 0;
    const expected = [];
    for (let i = 0; i < state.legs.length; i++) {
      if (legInsideCtr(i)) { expected.push('---'); continue; }
      const { dist } = geo(state.waypoints[i], state.waypoints[i + 1]);
      cum += dist / state.legs[i].flightSpeed;
      expected.push(toHMS(cum));
    }
    return { got: rows.map(tr => cell(tr, 'cumTime')), expected,
      names: state.waypoints.map(w => w.name) };
  });
  const before = await read();
  expect(before.got).toEqual(before.expected);
  // Delete HTZUK from the middle via the plan table's own delete control: the row's
  // button removes the leg's END waypoint, so row 1 (SFAIM -> HTZUK) is the one.
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')]
      .filter(tr => tr.querySelector('.fp-del button'));
    rows[1].querySelector('.fp-del button').click();
  });
  await page.waitForFunction(() => state.waypoints.length === 3);
  const after = await read();
  expect(after.names).toEqual(['LLHZ', 'SFAIM', 'NAGID']);
  expect(after.got).toEqual(after.expected);
  expect(after.got[0]).toBe('---');               // CTR leg still gated on the new route
  expect(after.got[1]).not.toBe(before.got[2]);   // recomputed, not carried over
});

test('a boundaries fetch that lands after the first paint still gates the route', async ({ page }) => {
  // A restored route can draw before data/ctr-boundaries.json resolves. That first
  // paint memoises "no CTR anywhere"; the load completing must invalidate the memo,
  // or the plan shows full time for the whole session.
  let release;
  const held = new Promise(r => { release = r; });
  await page.route('**/ctr-boundaries.json*', async r => { await held; r.continue(); });
  await page.addInitScript(() => {
    try { for (const s of ['build', 'view', 'display']) localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof legInsideCtr === 'function');
  await page.evaluate(async () => { await loadAirfields(); await loadNavWaypoints(); });
  await route(page, ['LLHZ', 'SFAIM', 'HTZUK']);
  // The fetch is still held: the CTR leg reads as ordinary route time, memo built.
  expect(await page.evaluate(() => legInsideCtr(0))).toBe(false);
  release();
  await page.waitForFunction(() => legInsideCtr(0) === true, { timeout: 8000 });
});

test('a failed graph fetch does not disable derivation for the session', async ({ page }) => {
  await boot(page);
  // First attempt fails: stub the graph loader to the transient-failure shape an
  // offline start produces. (A network-level abort is defeated by the service worker's
  // cache, which serves the graph without ever hitting page.route.)
  await page.evaluate(() => {
    window._testOrigFplLoad = fplLoadRouteGraph;
    fplLoadRouteGraph = async () => false;
  });
  await route(page, ['LLIB', 'AMNON', 'TAVOR']);      // AMNON is derived-only inside
  await page.evaluate(() => legInsideCtr(0));         // kicks the derivation, which fails
  await page.waitForFunction(() => _ctrDerivePromise === null, { timeout: 8000 });
  expect(await page.evaluate(() => legInsideCtr(0))).toBe(false);
  // Connectivity returns. The route is unchanged -- the memoised gate itself must
  // re-kick the derivation (time-gated; the test collapses the backoff).
  await page.evaluate(() => {
    fplLoadRouteGraph = window._testOrigFplLoad;
    _ctrDeriveNextTry = 0;
    legInsideCtr(0);
  });
  await page.waitForFunction(() => legInsideCtr(0) === true, { timeout: 8000 });
});
