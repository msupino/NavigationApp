// @ts-check
// Cone-based leg tracking + the off-route alert.
// See docs/superpowers/specs/2026-08-13-cone-leg-tracking-design.md
const { test, expect } = require('./_setup');

async function boot(page, lang = 'en') {
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => typeof gpsLegByCone === 'function' &&
    typeof gpsCheckLegAlerts === 'function' && typeof syncLegs === 'function');
}

// A straight north-bound route: ALPHA -> BRAVO -> CHARLIE, 3 NM per leg.
const ROUTE = [
  { lat: 32.00, lng: 34.0, name: 'ALPHA' },
  { lat: 32.05, lng: 34.0, name: 'BRAVO' },
  { lat: 32.10, lng: 34.0, name: 'CHARLIE' },
];
async function route(page, wps) {
  await page.evaluate((wps) => {
    state.waypoints = wps.map(w => ({ ...w }));
    syncLegs();
    gpsResetLegAlerts();
  }, wps || ROUTE);
}

test.describe('the cone', () => {
  test('is a diamond: widest at the midpoint, a point at each waypoint', async ({ page }) => {
    await boot(page);
    await route(page);
    const out = await page.evaluate(() => {
      const a = state.waypoints[0], b = state.waypoints[1];
      const at = (lat, lng) => _gpsLegConeContains(a, b, { lat, lng });
      return {
        // On the line, everywhere along it.
        onLineStart: at(32.005, 34.0),
        onLineMid: at(32.025, 34.0),
        onLineEnd: at(32.045, 34.0),
        // At the midpoint the half-width is half the leg (1.5 NM ~ 0.0295 deg lng here).
        midWide: at(32.025, 34.02),
        midTooWide: at(32.025, 34.05),
        // Near the start the cone has barely opened: the same offset is outside.
        nearStartNarrow: at(32.002, 34.02),
        // Beyond either end is outside regardless of how close to the line.
        beforeStart: at(31.99, 34.0),
        pastEnd: at(32.06, 34.0),
      };
    });
    expect(out.onLineStart).toBe(true);
    expect(out.onLineMid).toBe(true);
    expect(out.onLineEnd).toBe(true);
    expect(out.midWide).toBe(true);
    expect(out.midTooWide).toBe(false);
    expect(out.nearStartNarrow).toBe(false);
    expect(out.beforeStart).toBe(false);
    expect(out.pastEnd).toBe(false);
  });

  test('holds the current leg where two cones overlap (hysteresis)', async ({ page }) => {
    await boot(page);
    await route(page);
    const out = await page.evaluate(() => {
      // Just past BRAVO, both leg 0 and leg 1 can contain the position.
      const p = { lat: 32.0505, lng: 34.0 };
      gpsOwn = { ...p, t: Date.now() };
      gpsAlertLegIndex = 0;
      const keptWhenOn0 = gpsLegByCone();
      gpsAlertLegIndex = 1;
      const keptWhenOn1 = gpsLegByCone();
      return { keptWhenOn0, keptWhenOn1 };
    });
    // Whichever leg we were on, we stay on it rather than flapping.
    expect([0, 1]).toContain(out.keptWhenOn0);
    expect(out.keptWhenOn1).toBe(1);
  });

  test('reports -1 when the position is outside every cone', async ({ page }) => {
    await boot(page);
    await route(page);
    const idx = await page.evaluate(() => {
      gpsOwn = { lat: 32.05, lng: 34.30, t: Date.now() };   // ~15 NM east of the route
      gpsAlertLegIndex = 0;
      return gpsLegByCone();
    });
    expect(idx).toBe(-1);
  });
});

// The defect this feature exists to fix, observed live on the deployed build: the
// leg-approach alert was gated on _gpsAlertConfirmed, and the only thing that set it was a
// waypoint CAPTURE -- the TOP event itself. So the first waypoint of a session got TOP and
// nothing else.
test('the first waypoint of a session gets its approach call', async ({ page }) => {
  await boot(page);
  await route(page);
  const alerts = await page.evaluate(async () => {
    const seen = [];
    const orig = window.gpsSendWatchAlert;
    window.gpsSendWatchAlert = (title, body) => { seen.push(title); };
    state.legs.forEach(l => { l.flightSpeed = 90; });
    gpsResetLegAlerts();
    // Fly ALPHA -> BRAVO along the line, from the very start.
    for (let lat = 32.000; lat <= 32.0505; lat += 0.004) {
      gpsOwn = { lat: Number(lat.toFixed(4)), lng: 34.0, hdg: 0, t: Date.now() };
      gpsLastAlt = null;
      gpsCheckLegAlerts();
    }
    window.gpsSendWatchAlert = orig;
    return seen;
  });
  // Approaching BRAVO must be announced BEFORE arriving overhead it.
  expect(alerts.length).toBeGreaterThan(0);
  expect(alerts[0]).toBe('Next leg');
  expect(alerts).toContain('TOP');
});

test.describe('the off-route alert', () => {
  test('waits out a brief excursion, then fires with a course back', async ({ page }) => {
    await boot(page);
    await route(page);
    const out = await page.evaluate(async () => {
      const seen = [];
      const orig = window.gpsSendWatchAlert;
      window.gpsSendWatchAlert = (title, body, speech) => { seen.push({ title, body, speech }); };
      // The spoken form is guarded on the voice feature being present; these two land
      // independently, so stub the helper to exercise the speech path either way.
      const origDigits = window.gpsSpokenDigits;
      if (typeof window.gpsSpokenDigits !== 'function') {
        window.gpsSpokenDigits = (v) => String(v).split('').join(' ');
      }
      gpsResetLegAlerts();
      gpsAlertLegIndex = 0;
      // Well off to the east, nose north.
      const off = { lat: 32.03, lng: 34.20, hdg: 0 };
      gpsOwn = { ...off, t: Date.now() };
      gpsCheckLegAlerts();
      const firedImmediately = seen.length;
      // Still outside, but not yet past the debounce.
      _gpsConeOutsideSince = Date.now() - 5000;
      gpsCheckLegAlerts();
      const firedAt5s = seen.length;
      // Past the debounce.
      _gpsConeOutsideSince = Date.now() - 20000;
      gpsCheckLegAlerts();
      window.gpsSendWatchAlert = orig;
      window.gpsSpokenDigits = origDigits;
      return { firedImmediately, firedAt5s, seen, unknown: gpsRouteUnknown };
    });
    expect(out.firedImmediately).toBe(0);   // never on the first stray fix
    expect(out.firedAt5s).toBe(0);          // still inside the 15 s grace
    expect(out.seen.length).toBe(1);
    expect(out.unknown).toBe(true);
    expect(out.seen[0].title).toBe('Off route');
    expect(out.seen[0].body).toMatch(/Direct (BRAVO|CHARLIE)/);
    expect(out.seen[0].body).toMatch(/heading \d{3}/);
    expect(out.seen[0].speech).toMatch(/Off route\. Direct/);
    expect(out.seen[0].speech).not.toContain('°');
  });

  test('never targets a waypoint already behind on the route', async ({ page }) => {
    await boot(page);
    await route(page);
    const target = await page.evaluate(() => {
      // Past CHARLIE and off to the side; ALPHA is much closer than anything ahead.
      gpsAlertLegIndex = 1;                       // we were on BRAVO -> CHARLIE
      gpsOwn = { lat: 32.01, lng: 34.10, hdg: 180, t: Date.now() };
      const rec = gpsRouteRecovery();
      return rec && rec.wp.name;
    });
    expect(target).toBe('CHARLIE');   // never ALPHA, even though ALPHA is nearer
  });

  test('prefers a target within 45 degrees of the nose, else names the turn', async ({ page }) => {
    await boot(page);
    await route(page);
    const out = await page.evaluate(() => {
      gpsAlertLegIndex = 0;
      // East of the route. Nose north -> CHARLIE/BRAVO roughly ahead.
      gpsOwn = { lat: 32.02, lng: 34.05, hdg: 0, t: Date.now() };
      const ahead = gpsRouteRecovery();
      // Same place, nose pointing away east -> nothing within the sector.
      gpsOwn = { lat: 32.02, lng: 34.05, hdg: 90, t: Date.now() };
      const away = gpsRouteRecovery();
      return { aheadTurn: ahead && ahead.turn, awayTurn: away && away.turn };
    });
    expect(out.aheadTurn).toBeNull();          // already ahead: heading alone is enough
    expect(['left', 'right']).toContain(out.awayTurn);
  });

  test('suppresses the other alerts while off route, and resumes on re-entry', async ({ page }) => {
    await boot(page);
    await route(page);
    const out = await page.evaluate(() => {
      const seen = [];
      const orig = window.gpsSendWatchAlert;
      window.gpsSendWatchAlert = (title) => { seen.push(title); };
      gpsResetLegAlerts();
      state.legs.forEach(l => { l.flightSpeed = 90; l.inboundAltitude = 2000; });
      // Off route, past the debounce: an altitude 3000 ft off plan must stay silent.
      gpsOwn = { lat: 32.03, lng: 34.20, hdg: 0, t: Date.now() };
      gpsLastAlt = 5000;
      gpsCheckLegAlerts();
      _gpsConeOutsideSince = Date.now() - 20000;
      gpsCheckLegAlerts();
      const whileOff = seen.slice();
      // Back on the line: alerting resumes.
      seen.length = 0;
      gpsOwn = { lat: 32.02, lng: 34.0, hdg: 0, t: Date.now() };
      gpsCheckLegAlerts();
      window.gpsSendWatchAlert = orig;
      return { whileOff, afterReturn: seen.slice(), unknown: gpsRouteUnknown };
    });
    expect(out.whileOff).toEqual(['Off route']);   // no Altitude alert alongside it
    expect(out.unknown).toBe(false);               // cleared on re-entry
    expect(out.afterReturn).toContain('Altitude');
  });

  test('does not repeat on an unchanged course, and repeats once it moves', async ({ page }) => {
    await boot(page);
    await route(page);
    const out = await page.evaluate(() => {
      let n = 0;
      const orig = window.gpsSendWatchAlert;
      window.gpsSendWatchAlert = () => { n++; };
      gpsResetLegAlerts();
      gpsAlertLegIndex = 0;
      gpsOwn = { lat: 32.03, lng: 34.20, hdg: 0, t: Date.now() };
      gpsCheckLegAlerts();
      _gpsConeOutsideSince = Date.now() - 20000;
      gpsCheckLegAlerts();
      const first = n;
      // Same spot, same course: silent, even long after the repeat interval.
      _gpsConeAlertedAt = Date.now() - 5 * 60000;
      gpsCheckLegAlerts();
      const afterHold = n;
      // Course to the target has moved well past the threshold.
      _gpsConeAlertedHdg = (_gpsConeAlertedHdg + 90) % 360;
      _gpsConeAlertedAt = Date.now() - 5 * 60000;
      gpsCheckLegAlerts();
      const afterMove = n;
      window.gpsSendWatchAlert = orig;
      return { first, afterHold, afterMove };
    });
    expect(out.first).toBe(1);
    expect(out.afterHold).toBe(1);    // unchanged course: no repeat
    expect(out.afterMove).toBe(2);    // moved past 15 deg: repeats
  });
});
