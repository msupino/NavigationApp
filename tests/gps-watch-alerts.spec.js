const { test, expect } = require('./_setup');

// Playwright's default context is desktop Chromium -- _gpsIsMobileDevice() would read
// userAgentData.mobile as false there and gate every web-notification test out. Stubbing
// userAgentData.mobile:true is what the function checks FIRST, so this is enough regardless
// of the real UA string.
function installMobileDeviceStub() {
  try {
    Object.defineProperty(navigator, 'userAgentData', { value: { mobile: true }, configurable: true });
  } catch (e) { /* already non-configurable in this engine -- ignore */ }
}

// Stubs the web-Notification path so gpsSendWatchAlert's fallback is observable without a
// real permission prompt. Native (Capacitor LocalNotifications) path is covered separately.
// Also neutralises navigator.serviceWorker: gpsSendWatchAlert routes through a service
// worker's showNotification() when one is active (the Android-Chrome fix), and this app's
// own real service worker may well be registered in the test page too -- without this, the
// alert would go to the REAL showNotification(), invisible to window.__notifications, and
// every test below would see nothing fire. The service-worker path itself gets its own
// dedicated test with its own fake registration.
async function stubWebNotify(page) {
  await page.addInitScript(installMobileDeviceStub);
  await page.addInitScript(() => {
    window.__notifications = [];
    class FakeNotification {
      constructor(title, opts) { window.__notifications.push({ title, body: (opts || {}).body }); }
    }
    FakeNotification.permission = 'granted';
    FakeNotification.requestPermission = () => Promise.resolve('granted');
    window.Notification = FakeNotification;
    try {
      Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
    } catch (e) { /* already non-configurable in this engine -- ignore */ }
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

  test('includes the NEXT leg\'s planned altitude and heading, not the leg being finished', async ({ page }) => {
    await stubWebNotify(page);
    await bootLive(page);
    const out = await page.evaluate(() => {
      // ALPHA->BRAVO->CHARLIE, due east both legs. The alert on approaching BRAVO should
      // describe the BRAVO->CHARLIE leg (5000 ft, ~090), not the ALPHA->BRAVO leg it's
      // still finishing (deliberately given a different altitude to prove it's not that one).
      state.waypoints = [
        { lat: 32.00, lng: 34.00, name: 'ALPHA' },
        { lat: 32.00, lng: 34.50, name: 'BRAVO' },
        { lat: 32.00, lng: 35.00, name: 'CHARLIE' },
      ];
      syncLegs();
      state.legs[0].inboundAltitude = 2000;   // the leg being finished -- must NOT appear
      state.legs[1].inboundAltitude = 5000;   // the leg being approached -- must appear
      startLiveLocation();
      window.__liveCb(window.__fix(31.9992, 34.5, { speedMs: 15.4 }));
      // Expected heading via the SAME conversion the code uses -- magnetic, not the raw
      // true bearing geo() returns, so this doesn't hardcode a variation-dependent number.
      const expectedHdg = toMagnetic(geo(state.waypoints[1], state.waypoints[2]).brg);
      return { notif: window.__notifications.slice(), expectedHdg };
    });
    expect(out.notif.length).toBe(1);
    expect(out.notif[0].body).toContain('BRAVO');
    expect(out.notif[0].body).toContain('5000 ft');
    expect(out.notif[0].body).not.toContain('2000 ft');
    expect(out.notif[0].body).toContain('hdg ' + out.expectedHdg + '°');
  });

  test('the next leg\'s heading is wind-corrected, matching the leg inspector\'s own "With wind" readout', async ({ page }) => {
    await stubWebNotify(page);
    await bootLive(page);
    const out = await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.00, lng: 34.00, name: 'ALPHA' },
        { lat: 32.00, lng: 34.50, name: 'BRAVO' },
        { lat: 32.00, lng: 35.00, name: 'CHARLIE' },
      ];
      syncLegs();
      // A crosswind on the BRAVO->CHARLIE leg specifically -- enough to produce a real,
      // non-zero WCA (not just rounding noise), so a fix that silently dropped wind
      // correction would report a heading a few degrees off, not just "wrong by 1".
      state.legs[1].flightSpeed = 90;
      state.legs[1].wind = { dir: 0, speed: 20 };   // wind FROM due north, straight crosswind
      startLiveLocation();
      window.__liveCb(window.__fix(31.9992, 34.5, { speedMs: 15.4 }));
      // Expected heading via the SAME two-step calculation the code (and the leg
      // inspector's own live readout in interact.js) both use: course -> windTriangle -> magnetic.
      const brg = geo(state.waypoints[1], state.waypoints[2]).brg;
      const w = legWindFor(state.legs[1]);
      const fx = windTriangle(brg, state.legs[1].flightSpeed, w);
      const expectedHdg = toMagnetic(fx.hdgTrue);
      const expectedPlainHdg = toMagnetic(brg);
      return { notif: window.__notifications.slice(), expectedHdg, expectedPlainHdg };
    });
    expect(out.notif.length).toBe(1);
    // Sanity: this scenario really does produce a different number than the plain
    // course would -- otherwise the test can't tell a correct fix from a silently
    // reverted one.
    expect(out.expectedHdg).not.toBe(out.expectedPlainHdg);
    expect(out.notif[0].body).toContain('hdg ' + out.expectedHdg + '°');
  });

  test('omits altitude/heading on the last leg -- nothing to prep for', async ({ page }) => {
    await stubWebNotify(page);
    await bootLive(page);
    const out = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.0, lng: 34.5, name: 'BRAVO' }];
      syncLegs();
      state.legs[0].inboundAltitude = 3000;   // the only leg, being finished, not approached
      startLiveLocation();
      window.__liveCb(window.__fix(31.9992, 34.5, { speedMs: 15.4 }));
      return window.__notifications.slice();
    });
    expect(out.length).toBe(1);
    expect(out[0].body).toBe('Approaching BRAVO');   // no trailing ", N ft, hdg N°" at all
  });

  test('omits altitude when the next leg has none entered, keeps the heading', async ({ page }) => {
    await stubWebNotify(page);
    await bootLive(page);
    const out = await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.00, lng: 34.00, name: 'ALPHA' },
        { lat: 32.00, lng: 34.50, name: 'BRAVO' },
        { lat: 32.00, lng: 35.00, name: 'CHARLIE' },
      ];
      syncLegs();
      // state.legs[1].inboundAltitude left unset.
      startLiveLocation();
      window.__liveCb(window.__fix(31.9992, 34.5, { speedMs: 15.4 }));
      const expectedHdg = toMagnetic(geo(state.waypoints[1], state.waypoints[2]).brg);
      return { notif: window.__notifications.slice(), expectedHdg };
    });
    expect(out.notif.length).toBe(1);
    expect(out.notif[0].body).not.toContain('ft');
    expect(out.notif[0].body).toContain('hdg ' + out.expectedHdg + '°');
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

test.describe('no-route test nudge (temporary)', () => {
  test('waits for the permission answer before firing -- a delayed grant is not silently dropped', async ({ page }) => {
    await page.addInitScript(installMobileDeviceStub);
    await page.addInitScript(() => {
      window.__notifications = [];
      let resolveGrant;
      window.__grant = new Promise((r) => { resolveGrant = r; });
      window.__triggerGrant = () => resolveGrant();
      class FakeNotification {
        constructor(title, opts) { window.__notifications.push({ title, body: (opts || {}).body }); }
      }
      FakeNotification.permission = 'default';
      // Mirrors a real permission prompt: resolves only once the pilot answers it, not
      // synchronously -- the exact case that used to lose the nudge (checked immediately
      // after asking, before the answer came back).
      FakeNotification.requestPermission = () => window.__grant.then(() => {
        FakeNotification.permission = 'granted';
        return 'granted';
      });
      window.Notification = FakeNotification;
      try {
        Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
      } catch (e) { /* ignore */ }
      window.__liveCb = null;
      navigator.geolocation.watchPosition = (cb) => { window.__liveCb = cb; return 11; };
      navigator.geolocation.clearWatch = () => {};
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof startLiveLocation === 'function');
    const before = await page.evaluate(() => {
      state.waypoints = [];   // no route loaded
      startLiveLocation();
      return window.__notifications.length;
    });
    expect(before).toBe(0);         // not answered yet -- must not have fired already
    await page.evaluate(() => window.__triggerGrant());
    await page.waitForFunction(() => window.__notifications.length > 0);
    expect(await page.evaluate(() => window.__notifications.length)).toBe(1);
  });

  test('does not fire when a route is already loaded', async ({ page }) => {
    await stubWebNotify(page);
    await page.addInitScript(() => {
      window.__liveCb = null;
      navigator.geolocation.watchPosition = (cb) => { window.__liveCb = cb; return 11; };
      navigator.geolocation.clearWatch = () => {};
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof startLiveLocation === 'function');
    const n = await page.evaluate(async () => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.0, lng: 35.0, name: 'BRAVO' }];
      syncLegs();
      startLiveLocation();
      await new Promise((r) => setTimeout(r, 20));   // let the (already-granted) permission promise settle
      return window.__notifications.length;
    });
    expect(n).toBe(0);
  });
});

test.describe('web delivery via service worker (the Android Chrome fix)', () => {
  test('routes through registration.showNotification() instead of the bare constructor when a service worker is active', async ({ page }) => {
    await page.addInitScript(installFixHelper);
    await page.addInitScript(installMobileDeviceStub);
    await page.addInitScript(() => {
      window.__shown = [];
      window.__plainConstructed = 0;
      class FakeNotification {
        constructor() { window.__plainConstructed++; }   // must NOT be reached
      }
      FakeNotification.permission = 'granted';
      FakeNotification.requestPermission = () => Promise.resolve('granted');
      window.Notification = FakeNotification;
      const fakeRegistration = {
        showNotification: (title, opts) => {
          window.__shown.push({ title, body: (opts || {}).body });
          return Promise.resolve();
        },
      };
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { ready: Promise.resolve(fakeRegistration) }, configurable: true,
      });
      window.__liveCb = null;
      navigator.geolocation.watchPosition = (cb) => { window.__liveCb = cb; return 11; };
      navigator.geolocation.clearWatch = () => {};
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof startLiveLocation === 'function' &&
      typeof gpsCheckLegAlerts === 'function');
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.008, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      startLiveLocation();
      window.__liveCb(window.__fix(31.9992, 34.0, { speedMs: 15.4 }));
    });
    await page.waitForFunction(() => window.__shown.length > 0);
    const out = await page.evaluate(() => ({ shown: window.__shown.slice(), constructed: window.__plainConstructed }));
    expect(out.shown.length).toBe(1);
    expect(out.shown[0].body).toContain('BRAVO');
    expect(out.constructed).toBe(0);   // the bare constructor was never touched
  });

  test('falls back to the bare constructor if no service worker is active (no hang)', async ({ page }) => {
    await stubWebNotify(page);
    await page.addInitScript(installFixHelper);
    await page.addInitScript(() => {
      window.__liveCb = null;
      navigator.geolocation.watchPosition = (cb) => { window.__liveCb = cb; return 11; };
      navigator.geolocation.clearWatch = () => {};
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof startLiveLocation === 'function');
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.008, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      startLiveLocation();
      window.__liveCb(window.__fix(31.9992, 34.0, { speedMs: 15.4 }));
    });
    // stubWebNotify already neutralises navigator.serviceWorker -- this must fire right
    // away via the plain() fallback, not wait out the 800 ms safety timeout.
    expect(await page.evaluate(() => window.__notifications.length)).toBe(1);
  });
});

test.describe('desktop skip (no point in web notifications on a PC)', () => {
  test('does not request permission or send, on a non-mobile browser', async ({ page }) => {
    await page.addInitScript(installFixHelper);
    await page.addInitScript(() => {
      // Deliberately NOT stubbing userAgentData -- Playwright's default context is
      // desktop Chromium, which is exactly the case this gate exists for.
      window.__notifications = [];
      window.__permRequests = 0;
      class FakeNotification {
        constructor(title, opts) { window.__notifications.push({ title, body: (opts || {}).body }); }
      }
      FakeNotification.permission = 'default';
      FakeNotification.requestPermission = () => { window.__permRequests++; return Promise.resolve('granted'); };
      window.Notification = FakeNotification;
      window.__liveCb = null;
      navigator.geolocation.watchPosition = (cb) => { window.__liveCb = cb; return 11; };
      navigator.geolocation.clearWatch = () => {};
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof startLiveLocation === 'function');
    const out = await page.evaluate(() => {
      // ETA-triggering fix AND no route loaded (would also fire the no-route nudge) --
      // either one firing would be a leak past the desktop gate.
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.008, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      startLiveLocation();
      window.__liveCb(window.__fix(31.9992, 34.0, { speedMs: 15.4 }));
      return { permRequests: window.__permRequests, notif: window.__notifications.length };
    });
    expect(out.permRequests).toBe(0);   // never even asked
    expect(out.notif).toBe(0);
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

test.describe('drift-off-course alert (gpsCheckDrift, own 2-minute timer)', () => {
  // gpsCheckDrift runs on its own setInterval, not per-fix -- called directly in these
  // tests rather than waiting 2 real minutes. gpsOwn/gpsAlertLegIndex are set directly,
  // matching how other tests reach into plain globals rather than driving a fix sequence
  // just to arrive at a known state.

  test('does not fire when on course', async ({ page }) => {
    await stubWebNotify(page);
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof gpsCheckDrift === 'function');
    const n = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.0, lng: 35.0, name: 'BRAVO' }];
      syncLegs();
      gpsAlertLegIndex = 0;
      // Exactly on the leg's own bearing from its start -- zero track-angle error.
      const leg = geo(state.waypoints[0], state.waypoints[1]);
      const onCourse = { lat: state.waypoints[0].lat + Math.cos(leg.brg * Math.PI / 180) * 0.05,
        lng: state.waypoints[0].lng + Math.sin(leg.brg * Math.PI / 180) * 0.05 };
      gpsOwn = { lat: onCourse.lat, lng: onCourse.lng, hdg: leg.brg, t: Date.now() };
      gpsCheckDrift();
      return window.__notifications.length;
    });
    expect(n).toBe(0);
  });

  test('stays silent below the 10-degree threshold', async ({ page }) => {
    await stubWebNotify(page);
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof gpsCheckDrift === 'function');
    const n = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.0, lng: 35.0, name: 'BRAVO' }];
      syncLegs();
      gpsAlertLegIndex = 0;
      // A tiny lateral nudge early in the leg -- well under 10 deg of track-angle error.
      gpsOwn = { lat: 32.001, lng: 34.05, hdg: 90, t: Date.now() };
      gpsCheckDrift();
      return window.__notifications.length;
    });
    expect(n).toBe(0);
  });

  test('before the midpoint: reports drift-out and a doubled intercept angle', async ({ page }) => {
    await stubWebNotify(page);
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof gpsCheckDrift === 'function');
    const out = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.0, lng: 35.0, name: 'BRAVO' }];
      syncLegs();
      gpsAlertLegIndex = 0;
      // Well north of the direct line, early in the leg (< half its length).
      const pos = { lat: 32.15, lng: 34.15 };
      gpsOwn = { lat: pos.lat, lng: pos.lng, hdg: 90, t: Date.now() };
      const start = state.waypoints[0], end = state.waypoints[1];
      const leg = geo(start, end);
      const flown = geo(start, pos);
      const expectedOut = Math.round(Math.abs(((flown.brg - leg.brg + 540) % 360) - 180));
      gpsCheckDrift();
      return { notif: window.__notifications.slice(), expectedOut,
        pastMidpoint: flown.dist >= leg.dist / 2 };
    });
    expect(out.pastMidpoint).toBe(false);           // sanity: this test is the before-midpoint case
    expect(out.notif.length).toBe(1);
    const nums = out.notif[0].body.match(/\d+/g).map(Number);
    expect(nums).toHaveLength(2);
    const [driftOut, driftIn] = nums;
    expect(driftOut).toBe(out.expectedOut);
    expect(driftIn).toBe(driftOut * 2);              // classic doubled-angle intercept
    expect(out.notif[0].body).toContain('BRAVO');    // names which waypoint it's toward
  });

  test('past the midpoint: reports a single correction to the next waypoint instead', async ({ page }) => {
    await stubWebNotify(page);
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof gpsCheckDrift === 'function');
    const out = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.0, lng: 35.0, name: 'BRAVO' }];
      syncLegs();
      gpsAlertLegIndex = 0;
      // Off course but most of the way to BRAVO -- past the leg's midpoint.
      const pos = { lat: 32.15, lng: 34.85 };
      gpsOwn = { lat: pos.lat, lng: pos.lng, hdg: 90, t: Date.now() };
      const start = state.waypoints[0], end = state.waypoints[1];
      const leg = geo(start, end);
      const flown = geo(start, pos);
      gpsCheckDrift();
      return { notif: window.__notifications.slice(), pastMidpoint: flown.dist >= leg.dist / 2 };
    });
    expect(out.pastMidpoint).toBe(true);             // sanity: this test is the past-midpoint case
    expect(out.notif.length).toBe(1);
    expect(out.notif[0].body).toContain('BRAVO');
    expect(out.notif[0].body).not.toContain('intercept');
    expect(out.notif[0].body.match(/\d+/g)).toHaveLength(1);   // one correction number, not two
  });

  test('does not fire past the last leg', async ({ page }) => {
    await stubWebNotify(page);
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof gpsCheckDrift === 'function');
    const n = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.0, lng: 35.0, name: 'BRAVO' }];
      syncLegs();
      gpsAlertLegIndex = 1;   // past the only leg (index 0)
      gpsOwn = { lat: 32.15, lng: 35.15, hdg: 90, t: Date.now() };
      gpsCheckDrift();
      return window.__notifications.length;
    });
    expect(n).toBe(0);
  });

  test('the drift timer starts with live location and stops when tracking fully stops', async ({ page }) => {
    await page.addInitScript(() => {
      window.__liveCb = null;
      navigator.geolocation.watchPosition = (cb) => { window.__liveCb = cb; return 11; };
      navigator.geolocation.clearWatch = () => {};
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof startLiveLocation === 'function' &&
      typeof gpsMaybeStartDriftTimer === 'function');
    const out = await page.evaluate(() => {
      startLiveLocation();
      const runningAfterStart = _gpsDriftTimer !== null;
      stopLiveLocation();
      const clearedAfterStop = _gpsDriftTimer === null;
      return { runningAfterStart, clearedAfterStop };
    });
    expect(out.runningAfterStart).toBe(true);
    expect(out.clearedAfterStop).toBe(true);
  });

  test('the drift timer survives stopping a recording while live location is still on', async ({ page }) => {
    await page.addInitScript(() => {
      window.__recCb = null; window.__liveCb = null; let n = 0;
      navigator.geolocation.watchPosition = (cb) => { n++; if (n === 1) window.__recCb = cb; else window.__liveCb = cb; return n; };
      navigator.geolocation.clearWatch = () => {};
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof startGpsRecording === 'function' &&
      typeof startLiveLocation === 'function');
    const out = await page.evaluate(() => {
      startGpsRecording();
      startLiveLocation();
      const runningWithBoth = _gpsDriftTimer !== null;
      stopGpsRecording();
      const stillRunning = _gpsDriftTimer !== null;   // live location alone keeps it alive
      stopLiveLocation();
      const clearedAtEnd = _gpsDriftTimer === null;
      return { runningWithBoth, stillRunning, clearedAtEnd };
    });
    expect(out.runningWithBoth).toBe(true);
    expect(out.stillRunning).toBe(true);
    expect(out.clearedAtEnd).toBe(true);
  });
});

test.describe('loading a route while already tracking (applyRouteData)', () => {
  test('snaps the leg pointer to the nearest leg of the NEW route, and checks immediately', async ({ page }) => {
    await stubWebNotify(page);
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof applyRouteData === 'function' &&
      typeof serializeRoute === 'function');
    const out = await page.evaluate(() => {
      // Build a valid route blob via the app's own serializer/import round-trip (matches
      // how a saved-route load or an XC import actually calls applyRouteData).
      state.waypoints = [
        { lat: 32.00, lng: 34.00, name: 'ALPHA' },
        { lat: 32.00, lng: 34.50, name: 'BRAVO' },
        { lat: 32.00, lng: 35.00, name: 'CHARLIE' },
      ];
      syncLegs();
      state.legs[1].inboundAltitude = 3000;   // the leg BRAVO->CHARLIE has a plan
      const data = serializeRoute();

      // Already tracking, and already well inside the BRAVO->CHARLIE leg -- a leg the
      // pointer (still at whatever a fresh reset would give, 0) does not know about yet.
      gpsOwn = { lat: 32.001, lng: 34.75, hdg: 90, t: Date.now() };
      gpsLastAlt = 3200;   // 200 ft over BRAVO->CHARLIE's plan -- should alert immediately

      applyRouteData(data);

      return { legIndex: gpsAlertLegIndex, notif: window.__notifications.slice() };
    });
    expect(out.legIndex).toBe(1);         // snapped straight to the BRAVO->CHARLIE leg
    expect(out.notif.length).toBe(1);     // fired on load, not on some later fix
    expect(out.notif[0].body).toContain('3200');
  });

  test('a route loaded before any fix exists is a no-op, not a crash', async ({ page }) => {
    await stubWebNotify(page);
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof applyRouteData === 'function' &&
      typeof serializeRoute === 'function');
    const out = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.0, lng: 35.0, name: 'BRAVO' }];
      syncLegs();
      const data = serializeRoute();
      gpsOwn = null;   // nothing tracking yet
      applyRouteData(data);
      return { legIndex: gpsAlertLegIndex, notif: window.__notifications.length };
    });
    expect(out.legIndex).toBe(0);
    expect(out.notif).toBe(0);
  });
});

test.describe('connected-simulator path (io.js _simFetch)', () => {
  test('nudges toward loading a route when none is loaded -- the simulator has no idea what route NavAid has', async ({ page }) => {
    await stubWebNotify(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof simStart === 'function');
    const n = await page.evaluate(async () => {
      state.waypoints = [];   // no route loaded
      simStart();
      await new Promise((r) => setTimeout(r, 20));   // let the (already-granted) permission promise settle
      return window.__notifications.length;
    });
    expect(n).toBe(1);
  });

  test('real GPS wins if live location is also on -- a sim poll must not overwrite it', async ({ page }) => {
    await stubWebNotify(page);
    await page.addInitScript(installFixHelper);
    await page.addInitScript(() => {
      window.__liveCb = null;
      navigator.geolocation.watchPosition = (cb) => { window.__liveCb = cb; return 11; };
      navigator.geolocation.clearWatch = () => {};
    });
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof simStart === 'function' && typeof startLiveLocation === 'function');
    const out = await page.evaluate(async () => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.008, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      startLiveLocation();
      // Real GPS says we're far from BRAVO, low and slow -- if the sim poll below were
      // allowed through, gpsOwn/gpsLastGS/gpsLastAlt would flip to ITS numbers instead.
      window.__liveCb(window.__fix(31.90, 34.0, { speedMs: 10, altM: 100 }));
      const beforeSim = { lat: gpsOwn.lat, gs: Math.round(gpsLastGS), alt: Math.round(gpsLastAlt) };
      simStart();
      window.fetch = () => Promise.resolve({ ok: true, status: 200,
        json: async () => ({ latitude: 31.9992, longitude: 34.0, altitude: 3000, heading: 0, ias: 999 }) });
      await _simFetch();
      const afterSim = { lat: gpsOwn.lat, gs: Math.round(gpsLastGS), alt: Math.round(gpsLastAlt) };
      return { beforeSim, afterSim };
    });
    expect(out.afterSim).toEqual(out.beforeSim);   // untouched by the sim poll
  });

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

  test('still notifies on a desktop browser while connected to a simulator -- the "no point on PC" gate is for real flights, not this', async ({ page }) => {
    await page.addInitScript(() => {
      // Deliberately NOT stubbing userAgentData -- this is the desktop-skip gate's own
      // "not mobile" case. simOn (set by simStart() below) is what must override it.
      window.__notifications = [];
      class FakeNotification {
        constructor(title, opts) { window.__notifications.push({ title, body: (opts || {}).body }); }
      }
      FakeNotification.permission = 'granted';
      FakeNotification.requestPermission = () => Promise.resolve('granted');
      window.Notification = FakeNotification;
      try {
        Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
      } catch (e) { /* ignore */ }
    });
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof _simFetch === 'function' &&
      typeof gpsCheckLegAlerts === 'function');
    const out = await page.evaluate(async () => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.008, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      simStart();
      window.fetch = () => Promise.resolve({ ok: true, status: 200,
        json: async () => ({ latitude: 31.9992, longitude: 34.0, altitude: 2000, heading: 0, ias: 30 }) });
      await _simFetch();
      return window.__notifications.slice();
    });
    expect(out.length).toBe(1);
    expect(out[0].body).toContain('BRAVO');
  });
});
