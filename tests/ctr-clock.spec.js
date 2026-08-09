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
  // KNTRY is neither an exit point of LLHZ nor inside its CTR, so the leg to it counts --
  // nothing is assumed from it being the first leg.
  await route(page, ['LLHZ', 'KNTRY', 'HTZUK']);
  expect(await page.evaluate(() => [0, 1].map(i => legInsideCtr(i)))).toEqual([false, false]);
  // ...and the same on arrival.
  await route(page, ['HTZUK', 'KNTRY', 'LLHA']);
  expect(await page.evaluate(() => [0, 1].map(i => legInsideCtr(i)))).toEqual([false, false]);
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
  const derived = await page.evaluate(async () => {
    await loadCtrBoundaries();
    await fplLoadRouteGraph();
    await new Promise(r => setTimeout(r, 300));      // derivation is async
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
  // Out through SFAIM and home through KNTRY: KNTRY is not in Herzliya's CTR, so only the
  // first leg is quiet -- the last one counts, exactly as the names say.
  expect(r.inside).toEqual([true, false, false, false]);
  expect(r.times[0]).toBe('---');
  expect(r.times[3]).not.toBe('---');
  expect(r.total).not.toBe('--');
});
