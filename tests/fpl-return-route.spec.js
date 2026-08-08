// @ts-check
// Filing an out-and-back as one plan. The outbound and the return are separate NavAid
// routes -- that is how a pilot gets a nav log and exports for each direction -- and they
// are joined only in field 15, per the AIP א'-11 annex א' sample, which lists the whole
// flown chain including repeated points.
const { test, expect } = require('./_setup');

// Herzliya out to Kfar HaNagid and back, as filed through flp.co.il for 4XDAZ. The return
// is NOT a mirror: it omits APOLN/ARENA and comes home via KNTRY, because the Herzliya
// corridors are one-way (LLHZ->SFAIM out, KNTRY->LLHZ back).
const OUT = [
  { name: 'LLHZ', lat: 32.18078, lng: 34.83275 },
  { name: 'SFAIM', lat: 32.22, lng: 34.83 },
  { name: 'HTZUK', lat: 32.10, lng: 34.80 },
  { name: 'NAGID', lat: 31.90, lng: 34.75 },
];
const BACK = [
  { name: 'NAGID', lat: 31.90, lng: 34.75 },
  { name: 'HTZUK', lat: 32.10, lng: 34.80 },
  { name: 'KNTRY', lat: 32.16, lng: 34.81 },
  { name: 'LLHZ', lat: 32.18078, lng: 34.83275 },
];

const PTS = (() => {
  const g = JSON.parse(require('fs').readFileSync(
    require('path').join(__dirname, '..', 'docs', 'data', 'cvfr-route-graph.json'), 'utf8'));
  const o = {};
  for (const n of ['LLHZ', 'SFAIM', 'HTZUK', 'NAGID', 'KNTRY', 'ARENA', 'SUPER'])
    if (g.nodes[n]) o[n] = { lat: g.nodes[n].lat, lng: g.nodes[n].lng };
  return o;
})();

const PROFILE = {
  reg: '4XDAZ', type: 'C172', wake: 'L', equip: 'S', surv: 'C',
  pic: 'DAN NITSAN', license: '5127', cell: '0544711823',
  endurance: '0300', persons: 2, kind: 'routes', replyTo: 'pilot@example.com',
};

async function boot(page) {
  await page.addInitScript(() => {
    try { for (const s of ['build', 'view', 'display', 'export', 'print']) localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof buildIcaoFpl === 'function' && typeof syncLegs === 'function');
  // Real published coordinates, so the graph match is by position as it is in the app.
  await page.evaluate((pts) => { window.__pts = pts; }, PTS);
}

// Build the plan with `out` drawn and `back` supplied as a saved return route.
const plan = (page, out, back, extra) => page.evaluate(({ out, back, profile, extra }) => {
  state.waypoints = out.map(w => ({ ...w }));
  syncLegs();
  for (const l of state.legs) l.flightSpeed = 100;
  let retData = null;
  if (back) {
    const keep = state.waypoints, keepLegs = state.legs;
    state.waypoints = back.map(w => ({ ...w }));
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 100;
    retData = JSON.parse(JSON.stringify(serializeRoute()));
    state.waypoints = keep; state.legs = keepLegs;
  }
  const res = buildIcaoFpl(profile, Object.assign({
    dateLocal: '2026-08-07', timeLocal: '11:05', returnRouteData: retData,
    now: new Date('2026-08-07T05:00:00Z'),
  }, extra || {}));
  return { res, drawn: state.waypoints.map(w => w.name) };
}, { out, back, profile: PROFILE, extra: extra || null });

test('an out-and-back files as one plan, with the turn point named once', async ({ page }) => {
  await boot(page);
  const { res, drawn } = await plan(page, OUT, BACK);
  expect(res.errs, JSON.stringify(res.errs)).toBeUndefined();
  const route = res.text.split('\n').find(l => l.startsWith('-N'));
  // Field 15 lists the whole flown sequence, repeats included -- and NAGID, the turn point,
  // appears once rather than twice.
  expect(route).toBe('-N0100VFR SFAIM HTZUK NAGID HTZUK KNTRY');
  expect((route.match(/NAGID/g) || []).length).toBe(1);
  // The drawn route is untouched: it still has its own nav log and exports.
  expect(drawn).toEqual(['LLHZ', 'SFAIM', 'HTZUK', 'NAGID']);
});

test('the EET covers both halves, not just the outbound', async ({ page }) => {
  await boot(page);
  const oneWay = await plan(page, OUT, null);
  const both = await plan(page, OUT, BACK);
  const mins = r => r.res.eetMinutes;
  // Filing an out-and-back with the outbound's time is the defect showReturn has today:
  // the plan is held open for half the flight.
  expect(mins(both)).toBeGreaterThan(mins(oneWay) * 1.5);
});

test('a return that does not start where the route ends is refused', async ({ page }) => {
  await boot(page);
  const elsewhere = BACK.map(w => ({ ...w, lat: w.lat + 0.5 }));
  const { res } = await plan(page, OUT, elsewhere);
  const codes = (res.errs || []).map(e => (typeof e === 'string' ? e : e.code));
  // Two routes that do not meet are not one flight. Refused rather than filed with a
  // warning, exactly as an intermediate landing is refused.
  expect(codes).toContain('errFplJoinGap');
  expect(res.text).toBeUndefined();
});

test('joining two routes at an airfield is still a landing, and still refused', async ({ page }) => {
  await boot(page);
  // LLHZ -> LLES, then LLES -> LLHZ. The join is a field, so it is a landing: AIP א'-11 and
  // the filing desk both require a separate plan per leg
  // ("יש להגיש תוכנית טיסה נפרדת לכל לג").
  const toField = [OUT[0], OUT[1], { name: 'LLES', lat: 32.44, lng: 34.92 }];
  const fromField = [{ name: 'LLES', lat: 32.44, lng: 34.92 }, OUT[1], OUT[0]];
  const { res } = await plan(page, toField, fromField);
  const codes = (res.errs || []).map(e => (typeof e === 'string' ? e : e.code));
  expect(codes).toContain('errFplMidAirfield');
});

test('with no return route the plan is exactly what it was before', async ({ page }) => {
  await boot(page);
  const { res } = await plan(page, OUT, null);
  expect(res.errs).toBeUndefined();
  const route = res.text.split('\n').find(l => l.startsWith('-N'));
  // NAGID is not an aerodrome, so it is filed as ZZZZ with the point named in field 18 --
  // and it stays in field 15, which is the pre-existing documented behaviour.
  expect(route).toBe('-N0100VFR SFAIM HTZUK NAGID');
  expect(res.text).toContain('(FPL-4XDAZ-VG');
  expect(res.text).toContain('-LLHZ0805');
});

test('the modal offers the saved routes, and previews what will be filed', async ({ page }) => {
  await boot(page);
  await page.evaluate(({ back }) => {
    state.waypoints = back.map(w => ({ ...w }));
    syncLegs();
    routeLibrarySaveCurrent('Return via KNTRY');
    state.waypoints = [];
    syncLegs();
  }, { back: BACK });
  await page.evaluate(({ out }) => { state.waypoints = out.map(w => ({ ...w })); syncLegs(); }, { out: OUT });
  // The FPL button lives in the flight-plan panel, so that has to be open first.
  await page.evaluate(() => { showFlightPlan(); document.getElementById('fpl-open').click(); });
  const sel = page.locator('#fpl-return-route');
  await expect(sel).toBeVisible({ timeout: 5000 });
  // The saved route is offered...
  await expect(sel.locator('option')).toHaveCount(2);
  // ...and the preview already shows the DRAWN route expanded, because naming every
  // reporting point is on by default. Before a return is picked it ends at the turn point.
  await expect(page.locator('#fpl-return-preview')).toBeVisible();
  await expect(page.locator('#fpl-return-preview')).not.toContainText('KNTRY');
  await sel.selectOption({ index: 1 });
  // Picking one shows the whole flown chain before anything is filed.
  await expect(page.locator('#fpl-return-preview')).toBeVisible();
  await expect(page.locator('#fpl-return-preview')).toContainText('NAGID');
  await expect(page.locator('#fpl-return-preview')).toContainText('KNTRY');
});

test('an out-and-back pair is distinguishable in Hebrew', async ({ page }) => {
  // Reported from the saved-route list: "LLHZ ← צומת אשדוד" and "צומת אשדוד ← LLHZ" render
  // almost identically, because an arrow between a Hebrew name and a Latin code is a bidi
  // neutral and gets reordered. The same list feeds the return picker, where choosing the
  // wrong direction files the wrong route.
  await page.addInitScript(() => {
    try { for (const s of ['build', 'view', 'display']) localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof defaultSavedRouteName === 'function' && typeof syncLegs === 'function');
  const r = await page.evaluate(({ out, back }) => {
    state.waypoints = out.map(w => ({ ...w })); syncLegs();
    const nameOut = defaultSavedRouteName();
    state.waypoints = back.map(w => ({ ...w })); syncLegs();
    const nameBack = defaultSavedRouteName();
    return { nameOut, nameBack };
  }, { out: OUT, back: BACK });
  // Direction is stated in words, not by an arrow whose rendered side depends on bidi.
  expect(r.nameOut).toMatch(/^מ/);            // "מ..."
  expect(r.nameOut).toContain('אל');     // "אל"
  expect(r.nameOut).not.toContain('←');
  // ...and the two directions are plainly different strings.
  expect(r.nameOut).not.toBe(r.nameBack);
  // Each endpoint is isolated so a Latin code cannot drag the text around it.
  expect(r.nameOut).toContain('⁨');
  expect(r.nameOut).toContain('⁩');
});

// --- filing-time expansion ----------------------------------------------------------------
// The pilot draws sparsely; the plan names every published reporting point on the way, per
// the AIP א'-11 annex א' sample. Real coordinates, so the graph match is by position.
const G = JSON.parse(require('fs').readFileSync(
  require('path').join(__dirname, '..', 'docs', 'data', 'cvfr-route-graph.json'), 'utf8'));
const at = n => ({ name: n, lat: G.nodes[n].lat, lng: G.nodes[n].lng });

test('a sparsely drawn route files every reporting point on the way', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async ({ profile }) => {
    // Four picks, exactly as a pilot would tap them.
    state.waypoints = ['LLHZ', 'ARENA', 'SUPER', 'NAGID'].map(n => ({ ...window.__pts[n], name: n }));
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 100;
    const graph = await fplLoadRouteGraph();
    const res = buildIcaoFpl(profile, { dateLocal: '2026-08-07', timeLocal: '11:05',
      routeGraph: graph, now: new Date('2026-08-07T05:00:00Z') });
    return { res, drawn: state.waypoints.map(w => w.name) };
  }, { profile: PROFILE });
  const route = r.res.text.split('\n').find(l => l.startsWith('-N'));
  // The filed chain is what flp.co.il sent for this sortie, from four taps.
  expect(route).toBe('-N0100VFR SFAIM APOLN ARENA HTZUK RIDNG CLORE TYONA SUPER NTAIM BOVED NAGID');
  // ...and the drawn route is untouched: expansion is a filing concern only.
  expect(r.drawn).toEqual(['LLHZ', 'ARENA', 'SUPER', 'NAGID']);
});

test('expansion never drops a drawn point, and says when it cannot bridge', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async ({ profile }) => {
    // A point the graph does not know, between two it does.
    state.waypoints = [
      { ...window.__pts.LLHZ, name: 'LLHZ' },
      { lat: 31.5, lng: 34.4, name: 'OFFGRID' },
      { ...window.__pts.NAGID, name: 'NAGID' },
    ];
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 100;
    const graph = await fplLoadRouteGraph();
    return buildIcaoFpl(profile, { dateLocal: '2026-08-07', timeLocal: '11:05',
      routeGraph: graph, now: new Date('2026-08-07T05:00:00Z') });
  }, { profile: PROFILE });
  const route = (r.text || '').split('\n').find(l => l.startsWith('-N')) || '';
  // Whatever the graph can or cannot do, every point the pilot drew is still filed.
  expect(route).toContain('OFFGRID');
  expect(route).toContain('NAGID');
});

test('turning expansion off files exactly what was drawn', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async ({ profile }) => {
    state.waypoints = ['LLHZ', 'ARENA', 'SUPER', 'NAGID'].map(n => ({ ...window.__pts[n], name: n }));
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 100;
    return buildIcaoFpl(profile, { dateLocal: '2026-08-07', timeLocal: '11:05',
      routeGraph: null, now: new Date('2026-08-07T05:00:00Z') });
  }, { profile: PROFILE });
  const route = r.text.split('\n').find(l => l.startsWith('-N'));
  expect(route).toBe('-N0100VFR ARENA SUPER NAGID');
});

test('expansion honours one-way corridors', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const graph = await fplLoadRouteGraph();
    return {
      out: fplGraphChain(graph, 'LLHZ', 'HTZUK'),
      back: fplGraphChain(graph, 'HTZUK', 'LLHZ'),
    };
  });
  // Herzliya's corridors are one-way: out via SFAIM, home via KNTRY. A mirror would file a
  // corridor flown against its published direction.
  expect(r.out).toEqual(['LLHZ', 'SFAIM', 'HTZUK']);
  expect(r.back).toEqual(['HTZUK', 'KNTRY', 'LLHZ']);
});
