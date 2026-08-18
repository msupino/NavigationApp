// @ts-check
// Two fixes at the same place are not a direction. geo() still returns a number for them —
// 0 for identical coordinates, anything at all for a metre of jitter — and that number used
// to beat the compass from the second stationary fix onwards: a phone pointing 090 read
// "090m", then "355°" without the aircraft moving, and the heading-up map turned with it.
// Separately, the recorder's de-jitter used to drop the whole fix rather than just the track
// point, so a parked aircraft stopped updating altitude, speed, heading and alerts, and
// eventually called its own live recording stale.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 21; };
    navigator.geolocation.clearWatch = () => {};
    window.DeviceOrientationEvent = window.DeviceOrientationEvent || function () {};
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof startLiveLocation === 'function' &&
    typeof gpsCompassTrue === 'function' && typeof onGpsPosition === 'function');
}

const compass = (page, deg) => page.evaluate((d) => {
  _gpsOnDeviceOrientation({ absolute: true, alpha: (360 - d) % 360 });
}, deg);

const fixAt = (page, lat, lng, extra) => page.evaluate(([la, ln, ex]) => {
  window.__geoCb({
    coords: Object.assign({ latitude: la, longitude: ln, accuracy: 6, altitude: 300,
      speed: 0, heading: null }, ex || {}),
    timestamp: Date.now(),
  });
}, [lat, lng, extra || null]);

test('a second fix in the same place does not invent a course', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await compass(page, 90);
  await fixAt(page, 32.0, 34.0);
  const first = await page.evaluate(() => ({ hdg: gpsOwn.hdg, comp: gpsOwn.hdgCompass, shown: gpsReadoutHeading() }));
  expect(first.comp).toBe(true);
  await fixAt(page, 32.0, 34.0);                     // parked: the very same coordinates
  const second = await page.evaluate(() => ({ hdg: gpsOwn.hdg, comp: gpsOwn.hdgCompass, shown: gpsReadoutHeading() }));
  expect(second.comp).toBe(true);                    // still the compass, not a derived 0
  expect(second.shown).toBe(first.shown);
});

test('a metre of GPS jitter is not a course either', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await compass(page, 90);
  await fixAt(page, 32.0, 34.0);
  await fixAt(page, 32.00001, 34.00001);             // ~1.4 m — inside gpsMinMoveM
  expect(await page.evaluate(() => gpsOwn.hdgCompass)).toBe(true);
});

test('real movement still gives a GPS-derived course', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await compass(page, 90);
  await fixAt(page, 32.0, 34.0);
  await fixAt(page, 32.0100, 34.0);                  // ~1.1 km due north
  const out = await page.evaluate(() => ({ hdg: gpsOwn.hdg, comp: gpsOwn.hdgCompass }));
  expect(out.comp).toBe(false);
  expect(Math.round(out.hdg)).toBe(0);               // north, and this time it is true
});

test('while parked, a recording still updates altitude, heading and fix time', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    gpsRecording = true;
    gpsTrack.length = 0;
    const old = Date.now() - 30000;
    onGpsPosition({ coords: { latitude: 32, longitude: 34.8, accuracy: 5, altitude: 100, speed: 0, heading: 10 }, timestamp: old });
    const afterFirst = { pts: gpsTrack.length, t: gpsOwn.t, alt: gpsLastAlt, hdg: gpsOwn.hdg };
    onGpsPosition({ coords: { latitude: 32, longitude: 34.8, accuracy: 5, altitude: 200, speed: 0, heading: 90 }, timestamp: Date.now() });
    const afterSecond = { pts: gpsTrack.length, t: gpsOwn.t, alt: gpsLastAlt, hdg: gpsOwn.hdg, stale: gpsFixStale() };
    gpsRecording = false;
    return { afterFirst, afterSecond };
  });
  expect(out.afterFirst.pts).toBe(1);
  expect(out.afterSecond.pts).toBe(1);                       // de-jitter still holds the line
  expect(out.afterSecond.t).toBeGreaterThan(out.afterFirst.t);
  expect(out.afterSecond.alt).toBeCloseTo(200 * 3.28084, 0); // ...but the fix is live
  expect(Math.round(out.afterSecond.hdg)).toBe(90);
  expect(out.afterSecond.stale).toBe(false);
});
