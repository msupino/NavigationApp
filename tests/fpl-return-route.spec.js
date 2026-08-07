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
  // The saved route is offered, and nothing is composed until one is chosen.
  await expect(sel.locator('option')).toHaveCount(2);
  await expect(page.locator('#fpl-return-preview')).toBeHidden();
  await sel.selectOption({ index: 1 });
  // Picking one shows the whole flown chain before anything is filed.
  await expect(page.locator('#fpl-return-preview')).toBeVisible();
  await expect(page.locator('#fpl-return-preview')).toContainText('NAGID');
  await expect(page.locator('#fpl-return-preview')).toContainText('KNTRY');
});
