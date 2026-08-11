const { test, expect } = require('./_setup');

// Stubs the web-Notification path so gpsSendWatchAlert's fallback is observable without a
// real permission prompt. Native (Capacitor LocalNotifications) path is covered separately.
async function stubWebNotify(page) {
  await page.addInitScript(() => {
    window.__notifications = [];
    class FakeNotification {
      constructor(title, opts) { window.__notifications.push({ title, body: (opts || {}).body }); }
    }
    FakeNotification.permission = 'granted';
    FakeNotification.requestPermission = () => Promise.resolve('granted');
    window.Notification = FakeNotification;
  });
}

// window.__fix lives in the PAGE, not in Node -- page.evaluate cannot serialize a function
// argument across the boundary, so every helper that needs a fix shape defines it in-page.
function installFixHelper() {
  window.__fix = (lat, lng, opts = {}) => ({
    coords: { latitude: lat, longitude: lng, accuracy: 8, heading: opts.heading ?? null,
      speed: opts.speedMs ?? null, altitude: opts.altM ?? null },
    timestamp: Date.now(),
  });
}

async function bootLive(page) {
  await page.addInitScript(installFixHelper);
  await page.addInitScript(() => {
    window.__liveCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__liveCb = cb; return 11; };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof startLiveLocation === 'function' &&
    typeof gpsCheckLegAlerts === 'function');
}

async function bootRecording(page) {
  await page.addInitScript(installFixHelper);
  await page.addInitScript(() => {
    window.__recCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__recCb = cb; return 7; };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof startGpsRecording === 'function' &&
    typeof gpsCheckLegAlerts === 'function');
}

test.describe('leg-approach alert', () => {
  test('fires once when ETA to the next waypoint drops under the threshold, not before', async ({ page }) => {
    await stubWebNotify(page);
    await bootLive(page);
    const out = await page.evaluate(() => {
      // A short leg (~0.5 nm) so a modest groundspeed puts ETA under 120 s immediately.
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.008, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      startLiveLocation();
      // Far from BRAVO first: groundspeed known (30 kt), but ETA is minutes away -- no alert yet.
      window.__liveCb(window.__fix(31.90, 34.0, { speedMs: 15.4 }));   // ~30 kt
      const early = window.__notifications.length;
      // Now close enough (~0.5 nm) that ETA <= 120 s at 30 kt.
      window.__liveCb(window.__fix(31.9992, 34.0, { speedMs: 15.4 }));
      return { early, afterClose: window.__notifications.slice() };
    });
    expect(out.early).toBe(0);
    expect(out.afterClose.length).toBe(1);
    expect(out.afterClose[0].body).toContain('BRAVO');
  });

  test('does not repeat while still inside the ETA window for the same leg', async ({ page }) => {
    await stubWebNotify(page);
    await bootLive(page);
    const n = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.008, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      startLiveLocation();
      window.__liveCb(window.__fix(31.9992, 34.0, { speedMs: 15.4 }));
      window.__liveCb(window.__fix(31.9994, 34.0, { speedMs: 15.4 }));
      window.__liveCb(window.__fix(31.9996, 34.0, { speedMs: 15.4 }));
      return window.__notifications.length;
    });
    expect(n).toBe(1);
  });

  test('the forward-only pointer advances past a waypoint once abeam it, re-arming the next leg', async ({ page }) => {
    await stubWebNotify(page);
    await bootLive(page);
    const out = await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.00, lng: 34.00, name: 'ALPHA' },
        { lat: 32.02, lng: 34.00, name: 'BRAVO' },
        { lat: 32.04, lng: 34.00, name: 'CHARLIE' },
      ];
      syncLegs();
      startLiveLocation();
      // Landing exactly on BRAVO both captures it AND satisfies its own ETA<=0 condition --
      // that alert is expected here too, not just the pointer advance.
      window.__liveCb(window.__fix(32.02, 34.00, { speedMs: 15.4 }));
      const afterCapture = gpsAlertLegIndex;
      // Now close enough to CHARLIE for its own, separate ETA alert.
      window.__liveCb(window.__fix(32.0392, 34.00, { speedMs: 15.4 }));
      return { afterCapture, notif: window.__notifications.slice() };
    });
    expect(out.afterCapture).toBe(1);
    expect(out.notif.length).toBe(2);
    expect(out.notif[0].body).toContain('BRAVO');
    expect(out.notif[1].body).toContain('CHARLIE');
  });
});

test.describe('altitude alert', () => {
  test('fires once past +-100 ft of the current leg\'s planned altitude, clears back inside tolerance, refires on a fresh deviation', async ({ page }) => {
    await stubWebNotify(page);
    await bootRecording(page);
    const out = await page.evaluate(() => {
      const ftToM = (ft) => ft / 3.28084;
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 33.0, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      state.legs[0].inboundAltitude = 3000;
      startGpsRecording();
      // Explicit, sane speedMs on every fix -- back-to-back synthetic fixes share a
      // Date.now() millisecond often enough that the derived-speed fallback (distance /
      // elapsed time) produces an unrealistic speed and can trip the UNRELATED leg-approach
      // alert, confounding this altitude-only test. ~40 kt, and the 60 nm leg keeps ETA to
      // BRAVO far above the 120 s threshold throughout.
      const gs = { speedMs: 20 };
      window.__recCb(window.__fix(32.05, 34.0, { altM: ftToM(3150), ...gs }));   // +150 ft: past tolerance
      const afterFirst = window.__notifications.length;
      window.__recCb(window.__fix(32.06, 34.0, { altM: ftToM(3150), ...gs }));   // still deviated: no repeat
      const stillOne = window.__notifications.length;
      window.__recCb(window.__fix(32.07, 34.0, { altM: ftToM(3050), ...gs }));   // back within 100 ft: clears
      const afterClear = window.__notifications.length;
      window.__recCb(window.__fix(32.08, 34.0, { altM: ftToM(3200), ...gs }));   // deviates again: re-arms
      const afterSecond = window.__notifications.slice();
      return { afterFirst, stillOne, afterClear, afterSecond };
    });
    expect(out.afterFirst).toBe(1);
    expect(out.stillOne).toBe(1);
    expect(out.afterClear).toBe(1);
    expect(out.afterSecond.length).toBe(2);
    expect(out.afterSecond[0].body).toMatch(/3150.*3000|3000.*3150/);
  });

  test('does not fire when the leg has no planned altitude entered', async ({ page }) => {
    await stubWebNotify(page);
    await bootRecording(page);
    const n = await page.evaluate(() => {
      const ftToM = (ft) => ft / 3.28084;
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 33.0, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      // state.legs[0].inboundAltitude left unset.
      startGpsRecording();
      window.__recCb(window.__fix(32.05, 34.0, { altM: ftToM(9000), speedMs: 20 }));   // wildly off any sane plan
      return window.__notifications.length;
    });
    expect(n).toBe(0);
  });
});

test.describe('tracking session reset', () => {
  test('a fresh start clears the leg pointer left over from a previous session', async ({ page }) => {
    await stubWebNotify(page);
    await bootLive(page);
    const out = await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.00, lng: 34.00, name: 'ALPHA' },
        { lat: 32.02, lng: 34.00, name: 'BRAVO' },
        { lat: 32.04, lng: 34.00, name: 'CHARLIE' },
      ];
      syncLegs();
      startLiveLocation();
      window.__liveCb(window.__fix(32.02, 34.00, { speedMs: 15.4 }));   // advances past BRAVO
      const midFlight = gpsAlertLegIndex;
      stopLiveLocation();
      startLiveLocation();                                    // fresh session
      const afterRestart = gpsAlertLegIndex;
      return { midFlight, afterRestart };
    });
    expect(out.midFlight).toBe(1);
    expect(out.afterRestart).toBe(0);
  });
});

test.describe('native delivery (Capacitor LocalNotifications)', () => {
  test('uses the native plugin instead of the web Notification API when running as the APK shell', async ({ page }) => {
    await page.addInitScript(installFixHelper);
    await page.addInitScript(() => {
      window.__scheduled = [];
      window.__permAsked = 0;
      window.Capacitor = {
        isNativePlatform: () => true,
        Plugins: {
          LocalNotifications: {
            requestPermissions: () => { window.__permAsked++; return Promise.resolve({ display: 'granted' }); },
            schedule: (opts) => { window.__scheduled.push(opts); return Promise.resolve(); },
          },
        },
      };
      window.__liveCb = null;
      navigator.geolocation.watchPosition = (cb) => { window.__liveCb = cb; return 11; };
      navigator.geolocation.clearWatch = () => {};
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof startLiveLocation === 'function' &&
      typeof gpsCheckLegAlerts === 'function');
    const out = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.008, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      startLiveLocation();
      window.__liveCb(window.__fix(31.9992, 34.0, { speedMs: 15.4 }));
      return { permAsked: window.__permAsked, scheduled: window.__scheduled.slice() };
    });
    expect(out.permAsked).toBe(1);
    expect(out.scheduled.length).toBe(1);
    expect(out.scheduled[0].notifications[0].body).toContain('BRAVO');
  });
});

test.describe('connected-simulator path (io.js _simFetch)', () => {
  test('a poll close enough to the next waypoint fires the same alert a real GPS fix would', async ({ page }) => {
    await stubWebNotify(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof _simFetch === 'function' &&
      typeof gpsCheckLegAlerts === 'function');
    const out = await page.evaluate(async () => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.008, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      simStart();
      // ias assumed already in kt (aviation units) -- comfortably clears the 120 s ETA
      // threshold from ~0.5 nm out at 30 kt.
      window.fetch = () => Promise.resolve({ ok: true, status: 200,
        json: async () => ({ latitude: 31.9992, longitude: 34.0, altitude: 2000, heading: 0, ias: 30 }) });
      await _simFetch();
      return { notif: window.__notifications.slice(), gpsLastGS, gpsLastAlt };
    });
    expect(out.gpsLastGS).toBe(30);
    expect(out.gpsLastAlt).toBe(2000);
    expect(out.notif.length).toBe(1);
    expect(out.notif[0].body).toContain('BRAVO');
  });

  test('starting the simulator resets a leg pointer left over from a previous session', async ({ page }) => {
    await stubWebNotify(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof _simFetch === 'function' &&
      typeof gpsCheckLegAlerts === 'function');
    const out = await page.evaluate(async () => {
      state.waypoints = [
        { lat: 32.00, lng: 34.00, name: 'ALPHA' },
        { lat: 32.02, lng: 34.00, name: 'BRAVO' },
        { lat: 32.04, lng: 34.00, name: 'CHARLIE' },
      ];
      syncLegs();
      simStart();
      window.fetch = () => Promise.resolve({ ok: true, status: 200,
        json: async () => ({ latitude: 32.02, longitude: 34.00, altitude: 2000, heading: 0, ias: 30 }) });
      await _simFetch();
      const midFlight = gpsAlertLegIndex;
      simStop();
      simStart();
      const afterRestart = gpsAlertLegIndex;
      return { midFlight, afterRestart };
    });
    expect(out.midFlight).toBe(1);
    expect(out.afterRestart).toBe(0);
  });
});
