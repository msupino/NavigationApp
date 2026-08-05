// @ts-check
// Findings from the first full-codebase review round. Each test here failed before its fix.
// They are grouped because they share nothing but provenance — see the individual comments.
const { test, expect } = require('./_setup');

async function boot(page, q = '?lang=en&nogist') {
  await page.goto(q);
  await page.waitForFunction(() => typeof syncLegs === 'function' &&
    typeof state !== 'undefined' && typeof map !== 'undefined' &&
    typeof airfieldByIcao === 'function' && Array.isArray(airfields) && airfields.length > 0);
}

// --- core.js: the single-leg frequency collision -------------------------------------
test('a single-leg route uses the DEPARTURE frequency, not the destination', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    // Two airfields that both publish a primary frequency. On one leg, `legCount - 1` is 0 —
    // the departure's own index — and the stable sort let the destination win it, so a local
    // hop printed the ARRIVAL field's frequency from the moment of departure.
    const withFreq = airfields.filter(a => typeof airfieldPrimaryText === 'function'
      && airfieldPrimaryText(a));
    const [dep, dest] = withFreq;
    state.waypoints = [
      { lat: dep.lat, lng: dep.lng, name: dep.name },
      { lat: dest.lat, lng: dest.lng, name: dest.name },
    ];
    syncLegs();
    const clean = f => (typeof freqClean === 'function' ? freqClean(f) : f);
    return { depFreq: clean(airfieldPrimaryText(dep)), destFreq: clean(airfieldPrimaryText(dest)),
      leg0: legActiveFreq(0), sources: routeFreqSources().map(s => s.wpi) };
  });
  expect(r.depFreq).not.toBe(r.destFreq);      // the fixture must actually distinguish them
  expect(r.leg0).toBe(r.depFreq);
  // ...and no two sources may claim the same leg index on a one-leg route.
  expect(r.sources).toEqual([...new Set(r.sources)]);
});

test('a multi-leg route still hands the last leg to the destination', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const withFreq = airfields.filter(a => typeof airfieldPrimaryText === 'function'
      && airfieldPrimaryText(a));
    const [dep, dest] = withFreq;
    state.waypoints = [
      { lat: dep.lat, lng: dep.lng, name: dep.name },
      { lat: (dep.lat + dest.lat) / 2, lng: (dep.lng + dest.lng) / 2, name: 'MID' },
      { lat: dest.lat, lng: dest.lng, name: dest.name },
    ];
    syncLegs();
    const clean = f => (typeof freqClean === 'function' ? freqClean(f) : f);
    return { depFreq: clean(airfieldPrimaryText(dep)), destFreq: clean(airfieldPrimaryText(dest)),
      leg0: legActiveFreq(0), legLast: legActiveFreq(state.legs.length - 1) };
  });
  expect(r.leg0).toBe(r.depFreq);
  expect(r.legLast).toBe(r.destFreq);
});

// --- core.js: a nudge must not erase a typed altitude --------------------------------
test('moving a waypoint keeps a hand-typed altitude when nothing can re-derive it', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    // Two hand-placed points, so no charted segment exists to re-derive an altitude from.
    state.waypoints = [
      { lat: 32.30, lng: 34.80, name: 'A' },
      { lat: 32.40, lng: 34.86, name: 'B' },
    ];
    syncLegs();
    const leg = state.legs[0];
    leg.inboundAltitude = 3500;
    leg.outboundAltitude = 3500;
    markLegAltitudeManual(0);
    const sigBefore = leg._altSig;
    // ~5 m: inside SAME_REFERENCE_POINT_DEG (0.0002 deg, ~22 m), which is the app's own
    // "same point" tolerance. A 2 px drag at zoom 15 is about this. The signature still
    // changes (it keeps 5 decimals), which is what used to flip the leg to auto and write NaN.
    state.waypoints[1].lat = 32.40005;
    applyLegAltitudesToRoute();
    return { sigBefore, sigAfter: state.legs[0]._altSig,
      inbound: state.legs[0].inboundAltitude,
      auto: !!state.legs[0]._legAltitudeAuto };
  });
  expect(r.sigAfter).not.toBe(r.sigBefore);    // the signature really did change
  expect(r.inbound).toBe(3500);                // ...and the pilot's altitude survived
  expect(r.auto).toBe(false);                  // ...and it is still theirs, not auto
});

test('relocating a waypoint still clears a manual altitude', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.30, lng: 34.80, name: 'A' },
      { lat: 32.40, lng: 34.86, name: 'B' },
    ];
    syncLegs();
    state.legs[0].inboundAltitude = 3500;
    markLegAltitudeManual(0);
    // Far beyond the same-point tolerance: the leg now goes somewhere else, so keeping 3500
    // would be stale data on a flight plan. This is the behaviour
    // tests/leg-alt-stale-on-move.spec.js pins, and the threshold above must not weaken it.
    state.waypoints[0].lat = 31.50; state.waypoints[0].lng = 34.60;
    applyLegAltitudesToRoute();
    return { inbound: state.legs[0].inboundAltitude,
      auto: !!state.legs[0]._legAltitudeAuto };
  });
  expect(r.inbound).not.toBe(3500);
  expect(r.auto).toBe(true);
});

// --- io.js: the whole FPL message is ASCII ------------------------------------------
test('Hebrew in any filed field is refused, not silently dropped', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const hz = airfieldByIcao('LLHZ'), es = airfieldByIcao('LLES');
    // A published reporting point between the fields: ICAO field 15 wants a route, so a bare
    // aerodrome-to-aerodrome pair legitimately raises errFplNoPoints and could not show
    // whether the Latin guard fired.
    const mid = (window.navWP || []).find(w => w.name === 'APOLN') || null;
    state.waypoints = [
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      ...(mid ? [{ lat: mid.lat, lng: mid.lng, name: 'APOLN' }] : []),
      { lat: es.lat, lng: es.lng, name: 'LLES' },
    ];
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 90;
    const base = { reg: 'HLH', type: 'C172', wake: 'L', equip: 'S', surv: 'C', pic: 'A PILOT',
      license: '1', cell: '0500000000', persons: '2', endurance: '0500',
      replyTo: 'p@example.com', kind: 'routes' };
    const opts = { dateLocal: '2026-08-05', timeLocal: '09:20' };
    const res = {};
    for (const field of ['reg', 'type', 'pic', 'license', 'cell', 'wake', 'equip', 'surv']) {
      const built = buildIcaoFpl(Object.assign({}, base, { [field]: 'נחל' }), opts);
      res[field] = (built.errs || []).includes('errFplLatinOnly');
    }
    res.cleanBuilds = !buildIcaoFpl(base, opts).errs;
    return res;
  });
  // A Hebrew registration used to build "(FPL--VG" — an ICAO plan with no aircraft ID at all,
  // because fplRegistration strips non-A-Z0-9 to nothing. A Hebrew type went into field 9 raw.
  for (const field of ['reg', 'type', 'pic', 'license', 'cell', 'wake', 'equip', 'surv']) {
    expect(out[field], field + ' must be refused').toBe(true);
  }
  expect(out.cleanBuilds).toBe(true);          // ...and a Latin profile still files
});

// --- io.js / core.js: a half-typed burn rate must not destroy the profile ------------
test('clearing the fuel-burn box keeps the saved aircraft profile', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    localStorage.setItem('navaid.aircraft', JSON.stringify({ gph: 9.5, taxiGal: 1.2 }));
    loadAircraft();
    const hz = airfieldByIcao('LLHZ'), es = airfieldByIcao('LLES');
    state.waypoints = [
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      { lat: es.lat, lng: es.lng, name: 'LLES' },
    ];
    syncLegs();
    showFlightPlan();
  });
  const gph = page.locator('#aircraft-gph');
  await expect(gph).toHaveValue(/9\.5/);
  await gph.fill('');            // select-all + delete, the normal prelude to retyping
  const after = await page.evaluate(() => {
    const stored = localStorage.getItem('navaid.aircraft');
    // Reload the profile the way a fresh page would.
    aircraft = null;
    loadAircraft();
    return { stored, afterReload: aircraft };
  });
  // An empty box reads as "no profile" IN MEMORY, so the fuel cells show '--' while it is
  // empty -- deliberate, and pinned by tests/fuel-flight-plan.spec.js. What must not happen is
  // persisting it: saving null wrote the string "null", which loadAircraft read back as
  // truthy for good, so the profile was gone after a reload and the cells stayed '--'.
  expect(after.stored).not.toBe('null');
  expect(after.afterReload).toMatchObject({ gph: 9.5 });
  // ...and a real edit still lands.
  await gph.fill('7.25');
  expect(await page.evaluate(() => aircraft.gph)).toBe(7.25);
});

test('a poisoned aircraft value from an older build is ignored on load', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const out = {};
    for (const raw of ['null', '{}', '{"gph":0}', 'not json', '{"gph":8,"taxiGal":1}']) {
      localStorage.setItem('navaid.aircraft', raw);
      aircraft = null;
      loadAircraft();
      out[raw] = aircraft && aircraft.gph;
    }
    return out;
  });
  expect(r['null']).toBeFalsy();
  expect(r['{}']).toBeFalsy();
  expect(r['{"gph":0}']).toBeFalsy();
  expect(r['not json']).toBeFalsy();
  expect(r['{"gph":8,"taxiGal":1}']).toBe(8);   // a usable profile still loads
});

// --- draw.js: one tuning value must not blank the map -------------------------------
test('a zero-step VOR range ring skips the ring, not the whole map', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const withCoverage = (typeof vors !== 'undefined' ? vors : []).find(v => v.coverageNm > 0);
    if (!withCoverage) return { skipped: true };
    vorRef = withCoverage.ident;
    showVor = true;
    const hz = airfieldByIcao('LLHZ'), es = airfieldByIcao('LLES');
    state.waypoints = [
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      { lat: es.lat, lng: es.lng, name: 'LLES' },
    ];
    syncLegs();
    setTune('vorRangeRingSteps', 0);          // reachable from the gist and from ?tune=1
    let threw = null;
    try { draw(); } catch (e) { threw = String(e && e.message); }
    // The route line is drawn after the VOR overlay, so if draw() aborted it is missing.
    return { threw, tune: tune('vorRangeRingSteps'), drewRoute: state.legs.length > 0 };
  });
  if (r.skipped) return;
  expect(r.threw).toBeNull();
  expect(r.drewRoute).toBe(true);
});

// --- interact.js: a modal owns the keyboard ----------------------------------------
test('route-editing keys do nothing while a modal is open', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const hz = airfieldByIcao('LLHZ'), es = airfieldByIcao('LLES');
    state.waypoints = [
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      { lat: (hz.lat + es.lat) / 2, lng: (hz.lng + es.lng) / 2, name: 'MID' },
      { lat: es.lat, lng: es.lng, name: 'LLES' },
    ];
    syncLegs();
    state.selected = { type: 'wp', index: 2 };
    showFlightPlan();                          // any blocking modal
  });
  await expect(page.locator('.modal-back')).toHaveCount(1);
  for (const key of ['Backspace', 'Delete', 'd', 'x']) {
    await page.locator('body').press(key);
  }
  // Focus inside a dialog is not a "typing target", and Tab is trapped there, so Backspace is
  // the natural way out — it used to delete the selected waypoint behind the dialog.
  expect(await page.evaluate(() => state.waypoints.length)).toBe(3);
  // With the modal closed, the same key still works.
  await page.evaluate(() => {
    for (const b of [...document.querySelectorAll('.modal-back .modal-cancel')]) b.click();
    document.querySelectorAll('.modal-back').forEach(m => m.remove());
    state.selected = { type: 'wp', index: 2 };
  });
  await page.locator('body').press('Backspace');
  expect(await page.evaluate(() => state.waypoints.length)).toBe(2);
});
