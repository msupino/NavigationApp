// Leg time against a leg of KNOWN length, with the expected ETE hard-coded.
//
// The existing coverage (ui-audit-round2 "same per-leg time on the chart and in
// the plan") derives its expected distance from the same geo() the app uses, so
// chart and plan move together and stay green even if the distance itself drifts.
// Here the leg is 30.00 NM by construction and every ETE is a literal, so a unit
// slip, a changed Earth radius or a wind/climb term leaking into planning time
// breaks the assertion instead of hiding inside it.
const { test, expect } = require('./_setup');

// One degree of latitude is EARTH_NM * pi/180 = 60.0356 NM, NOT 60 — so the
// spacing for exactly 30 NM is 0.499663 deg on a single meridian (no cos(lat)
// term to worry about). Changing EARTH_NM is meant to trip this test.
const D_LAT = 0.499663;
const LEG_NM = 30;
const BASE = { lat: 31.5, lng: 34.9 };
const NORTH = { lat: 31.5 + D_LAT, lng: 34.9 };

// dist / speed, in whole minutes, for a 30 NM leg.
const CASES = [
  [45, '40:00'], [60, '30:00'], [75, '24:00'], [90, '20:00'],
  [100, '18:00'], [120, '15:00'], [150, '12:00'], [200, '9:00'],
];

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function' && typeof routeProfile === 'function');
}

test('the constructed leg really is 30.00 NM', async ({ page }) => {
  await boot(page);
  const dist = await page.evaluate(([a, b]) => geo(a, b).dist, [BASE, NORTH]);
  expect(dist).toBeCloseTo(LEG_NM, 2);
});

for (const [speed, expected] of CASES) {
  test(`a 30 NM leg at ${speed} kt reads ${expected} everywhere`, async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(([a, b, v]) => {
      state.waypoints = [{ ...a, name: 'A' }, { ...b, name: 'B' }];
      state.legs = []; syncLegs();
      state.legs[0].flightSpeed = v;
      state.legs[0].inboundAltitude = null;   // no altitude: nothing may add climb time
      state.wind = { dir: 270, speed: 40 };   // planning time is TAS-based: wind must not count
      draw();
      const prof = routeProfile();
      return {
        profile: toHMS(prof.legs[0].timeH),
        total: toHMS(prof.totalTimeH),
        kite: toHMS(legKiteTimeH(0, prof)),
        summary: document.getElementById('route-summary').textContent,
      };
    }, [BASE, NORTH, speed]);
    expect(out.profile).toBe(expected);
    expect(out.kite).toBe(expected);      // chart label
    expect(out.total).toBe(expected);     // single-leg route: total == the leg
    expect(out.summary).toContain(expected);
  });
}

test('an altitude on the leg does not change the ETE', async ({ page }) => {
  // A leg starting away from an airfield is flown level, so entering an altitude
  // must not buy or cost time — the V/S model only ramps out of a field.
  await boot(page);
  const out = await page.evaluate(([a, b]) => {
    const run = alt => {
      state.waypoints = [{ ...a, name: 'A' }, { ...b, name: 'B' }];
      state.legs = []; syncLegs();
      state.legs[0].flightSpeed = 120;
      state.legs[0].inboundAltitude = alt;
      draw();
      const p = routeProfile();
      return { leg: toHMS(p.legs[0].timeH), kite: toHMS(legKiteTimeH(0, p)) };
    };
    return { unset: run(null), low: run(1500), high: run(9500) };
  }, [BASE, NORTH]);
  expect(out.unset.leg).toBe('15:00');
  expect(out.low.leg).toBe('15:00');
  expect(out.high.leg).toBe('15:00');
  expect(out.high.kite).toBe('15:00');
});

test('two 30 NM legs at different speeds sum to the two literals', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(([a, b, dlat]) => {
    const c = { lat: b.lat + dlat, lng: b.lng };
    state.waypoints = [{ ...a, name: 'A' }, { ...b, name: 'B' }, { ...c, name: 'C' }];
    state.legs = []; syncLegs();
    state.legs[0].flightSpeed = 60;    // 30:00
    state.legs[1].flightSpeed = 120;   // 15:00
    state.legs.forEach(l => { l.inboundAltitude = null; });
    draw();
    const p = routeProfile();
    return { legs: p.legs.map(l => toHMS(l.timeH)), total: toHMS(p.totalTimeH),
             dists: p.legs.map(l => l.dist) };
  }, [BASE, NORTH, D_LAT]);
  expect(out.dists[0]).toBeCloseTo(LEG_NM, 2);
  expect(out.dists[1]).toBeCloseTo(LEG_NM, 2);
  expect(out.legs).toEqual(['30:00', '15:00']);
  expect(out.total).toBe('45:00');
});

test('halving the speed doubles the ETE exactly', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(([a, b]) => {
    const at = v => {
      state.waypoints = [{ ...a, name: 'A' }, { ...b, name: 'B' }];
      state.legs = []; syncLegs();
      state.legs[0].flightSpeed = v;
      state.legs[0].inboundAltitude = null;
      draw();
      return routeProfile().legs[0].timeH;
    };
    return { fast: at(120), slow: at(60) };
  }, [BASE, NORTH]);
  expect(out.slow / out.fast).toBeCloseTo(2, 6);
});
