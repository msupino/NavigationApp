// @ts-check
// A GPS fix reports course over ground, and only while moving: stationary or taxiing the
// device sends none and the own-ship freezes. The phone's compass can answer there — but
// only there. Course and heading are different quantities (they differ by the drift angle,
// which the off-course alert is built on), and a phone reads where it is clamped, through
// a steel airframe. So: fallback only, below taxi speed, and marked in the readout as
// `045m` rather than passed off as a GPS course's `045°`.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 12; };
    navigator.geolocation.clearWatch = () => {};
    // A device that has the API and needs no permission (Android-shaped).
    window.DeviceOrientationEvent = window.DeviceOrientationEvent || function () {};
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof startLiveLocation === 'function' &&
    typeof gpsCompassTrue === 'function');
}

// Feed a compass reading the way the browser would.
const compass = (page, deg, opts) => page.evaluate(([d, o]) => {
  _gpsOnDeviceOrientation(Object.assign({ absolute: true, alpha: (360 - d) % 360 }, o || {}));
}, [deg, opts || null]);

// One fix; `course` null means the device reported none (stationary).
const fix = (page, course, speedMs) => page.evaluate(([c, s]) => {
  window.__geoCb({
    coords: { latitude: 32.0, longitude: 34.0, accuracy: 6, altitude: 300,
      speed: s, heading: c },
    timestamp: Date.now(),
  });
}, [course, speedMs]);

const readout = (page) => page.evaluate(() => gpsReadoutHeading());

test('with no GPS course, the compass supplies the heading — marked with m', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await compass(page, 90);                       // pointing east, magnetic
  await fix(page, null, 0);                      // stationary: no course
  expect(await page.evaluate(() => gpsOwn.hdgCompass)).toBe(true);
  expect(await readout(page)).toBe('090m');      // magnetic in, magnetic out
});

test('a real GPS course always wins, and reads in degrees', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await compass(page, 90);
  await fix(page, 180, 30);                      // moving, with a course
  expect(await page.evaluate(() => gpsOwn.hdgCompass)).toBe(false);
  const shown = await readout(page);
  expect(shown.endsWith('°')).toBe(true);
  expect(shown).not.toContain('m');
});

test('above taxi speed the compass is ignored even with no course', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await compass(page, 90);
  // 20 m/s ≈ 39 kt with the device reporting no course: airborne, so the compass must not
  // stand in — a phone on a kneeboard is not the nose.
  const used = await page.evaluate(() => gpsCompassTrue(39));
  expect(used).toBeNull();
  expect(await page.evaluate(() => gpsCompassTrue(2))).not.toBeNull();
});

test('a stale reading is not a heading', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await compass(page, 90);
  const out = await page.evaluate(() => {
    const fresh = gpsCompassTrue(0);
    _gpsCompassAt = Date.now() - (GPS_COMPASS_STALE_MS + 1000);
    return { fresh, stale: gpsCompassTrue(0) };
  });
  expect(out.fresh).not.toBeNull();
  expect(out.stale).toBeNull();
});

test('a relative-only orientation event is refused', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await compass(page, 90, { absolute: false });
  expect(await page.evaluate(() => gpsCompassMag)).toBeNull();
});

test('landscape does not read 90 degrees off', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  const both = await page.evaluate(() => {
    const read = (angle) => {
      Object.defineProperty(window.screen, 'orientation', { value: { angle }, configurable: true });
      _gpsOnDeviceOrientation({ absolute: true, alpha: 270 });   // alpha 270 = pointing east
      return gpsCompassMag;
    };
    return { portrait: read(0), landscape: read(90) };
  });
  expect(both.portrait).toBe(90);
  expect(both.landscape).toBe(180);   // the screen's own rotation is taken out, not ignored
});

test('the switch turns it off', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await compass(page, 90);
  const off = await page.evaluate(() => {
    setTune('compassFallback', false);
    const v = gpsCompassTrue(0);
    setTune('compassFallback', true);
    return v;
  });
  expect(off).toBeNull();
});
