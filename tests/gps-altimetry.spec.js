// @ts-check
// A GPS fix is a GEOMETRIC height; a planned altitude is a PRESSURE height. Comparing the
// two raw produced "altitude off plan" calls on an aircraft flying exactly on plan: the
// geoid offset (~59 ft here) and the ISA temperature deviation (~4 ft per 1000 ft per °C)
// together clear the 100 ft alert tolerance on a warm day. The subscale setting is shown
// in inches of mercury beside the corrected altitude.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof gpsIndicatedAltitudeFt === 'function' &&
    typeof gpsRefreshQnh === 'function' && typeof syncLegs === 'function');
}

// A fixed weather reading: 1009.0 hPa, 30 °C at a 100 ft station.
const WX = { current: { pressure_msl: 1009.0, temperature_2m: 30 }, elevation: 30.48 };
const stubFetch = (page, payload) => page.evaluate((p) => {
  window.__wxCalls = [];
  window.__stubWx = (url) => {
    window.__wxCalls.push(url);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(p) });
  };
}, payload || WX);

test.describe('the correction', () => {
  test('takes the geoid off, then the temperature error', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => {
      const q = { hPa: 1009, inHg: 1009 / 33.8639, tempC: 30, elevFt: 100, at: Date.now() };
      return {
        geoidOnly: gpsIndicatedAltitudeFt(2000, { tempC: null }),   // no temperature to use
        corrected: gpsIndicatedAltitudeFt(2000, q),
        geoidFt: tune('geoidUndulationFt'),
      };
    });
    // 2000 ft above the ellipsoid is 1941 ft above mean sea level.
    expect(out.geoidOnly).toBeCloseTo(2000 - out.geoidFt, 3);
    // ISA at a 100 ft station is 14.8 °C, so 30 °C is +15.2 — at 1941 ft that is ~118 ft
    // of altimeter under-read, and the aircraft's ALTIMETER therefore shows ~1823 ft.
    expect(out.corrected).toBeGreaterThan(1800);
    expect(out.corrected).toBeLessThan(1840);
    expect(out.corrected).toBeLessThan(out.geoidOnly);   // warm air: indicated < true
  });

  test('is a no-op when switched off, and never touches a simulator altitude', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => {
      window.gpsLastAlt = 2000;
      window.gpsAltIsGeometric = true;
      const on = gpsAltitudeForCompare();
      window.gpsAltIsGeometric = false;          // a simulator reports indicated already
      const sim = gpsAltitudeForCompare();
      window.gpsAltIsGeometric = true;
      setTune('altimetryCorrection', false);
      const off = gpsAltitudeForCompare();
      setTune('altimetryCorrection', true);
      return { on, sim, off };
    });
    expect(out.on).toBeLessThan(2000);
    expect(out.sim).toBe(2000);
    expect(out.off).toBe(2000);
  });
});

test.describe('the pressure reading', () => {
  test('is fetched for the position and converted to inches', async ({ page }) => {
    await boot(page);
    await stubFetch(page);
    const out = await page.evaluate(async () => {
      await gpsRefreshQnh(32.18, 34.83, { fetch: window.__stubWx, force: true });
      return { q: gpsQnh, calls: window.__wxCalls, shown: gpsFormatInHg(gpsQnh.inHg) };
    });
    expect(out.q.hPa).toBe(1009);
    expect(out.q.inHg).toBeCloseTo(29.80, 2);
    expect(out.shown).toBe('29.80');            // two decimals, as a pilot sets the subscale
    expect(out.calls[0]).toContain('latitude=32.180');
    expect(out.calls[0]).toContain('pressure_msl');
  });

  test('is reused nearby and re-fetched once the aircraft has moved on', async ({ page }) => {
    await boot(page);
    await stubFetch(page);
    const calls = await page.evaluate(async () => {
      await gpsRefreshQnh(32.18, 34.83, { fetch: window.__stubWx, force: true });
      await gpsRefreshQnh(32.20, 34.85, { fetch: window.__stubWx });   // ~2 NM: reuse
      const afterNear = window.__wxCalls.length;
      await gpsRefreshQnh(33.10, 34.83, { fetch: window.__stubWx });   // ~55 NM: refetch
      return { afterNear, afterFar: window.__wxCalls.length };
    });
    expect(calls.afterNear).toBe(1);
    expect(calls.afterFar).toBe(2);
  });

  test('a failed fetch leaves the app exactly as it was', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(async () => {
      window.gpsQnh = null;
      window.gpsLastAlt = 2000;
      window.gpsAltIsGeometric = true;
      await gpsRefreshQnh(32.18, 34.83, { force: true, fetch: () => Promise.reject(new Error('offline')) });
      return { q: gpsQnh, alt: gpsAltitudeForCompare(), geoidFt: tune('geoidUndulationFt') };
    });
    expect(out.q).toBeNull();
    // No temperature to work with, so only the geoid part applies -- and nothing throws.
    expect(out.alt).toBeCloseTo(2000 - out.geoidFt, 3);
  });
});

test('the readout shows the corrected altitude and the subscale setting', async ({ page }) => {
  await boot(page);
  await stubFetch(page);
  const text = await page.evaluate(async () => {
    await gpsRefreshQnh(32.18, 34.83, { fetch: window.__stubWx, force: true });
    window.gpsLiveOn = true;
    window.gpsLastGS = 90;
    window.gpsLastAlt = 2000;
    window.gpsAltIsGeometric = true;
    window.gpsOwn = { lat: 32.18, lng: 34.83, hdg: 0, t: Date.now() };
    gpsUpdateReadout();
    return document.getElementById('gps-readout').textContent;
  });
  expect(text).toContain('90 kt');
  expect(text).toContain('29.80″');
  expect(text).not.toContain('2000 ft');     // the raw geometric height is never shown
  expect(text).toMatch(/18\d\d ft/);
});

test('the altitude alert measures the corrected value against the plan', async ({ page }) => {
  await boot(page);
  await stubFetch(page);
  const seen = await page.evaluate(async () => {
    await gpsRefreshQnh(32.00, 34.0, { fetch: window.__stubWx, force: true });
    state.waypoints = [
      { lat: 32.00, lng: 34.0, name: 'ALPHA' },
      { lat: 32.05, lng: 34.0, name: 'BRAVO' },
    ];
    syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 90; l.inboundAltitude = 1850; });
    gpsResetLegAlerts();
    const alerts = [];
    const orig = window.gpsSendWatchAlert;
    window.gpsSendWatchAlert = (title, body) => { alerts.push({ title, body }); };
    // 2000 ft above the ellipsoid ≈ 1823 ft indicated: 27 ft off a 1850 ft plan, silent.
    window.gpsAltIsGeometric = true;
    window.gpsLastAlt = 2000;
    window.gpsOwn = { lat: 32.025, lng: 34.0, hdg: 0, t: Date.now() };
    gpsCheckLegAlerts();
    const onPlan = alerts.filter(a => a.title === 'Altitude').length;
    // 300 ft higher is a real deviation and must still fire.
    window.gpsLastAlt = 2300;
    gpsCheckLegAlerts();
    const offPlan = alerts.filter(a => a.title === 'Altitude');
    window.gpsSendWatchAlert = orig;
    return { onPlan, offPlan };
  });
  expect(seen.onPlan).toBe(0);          // the false alarm this change exists to stop
  expect(seen.offPlan.length).toBe(1);
  expect(seen.offPlan[0].body).toMatch(/21\d\d ft/);   // reports what the altimeter shows
});
