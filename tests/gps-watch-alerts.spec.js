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
      // A short-ish leg so a live position close to BRAVO puts ETA (at the leg's PLANNED
      // speed, not the fix's reported one -- see the dedicated test for that) under 120 s.
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.008, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      startLiveLocation();
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
      // Far from BRAVO first: ETA is minutes away regardless of speed -- no alert yet.
      window.__liveCb(window.__fix(31.90, 34.0, { speedMs: 15.4 }));
      const early = window.__notifications.length;
      // Now close enough (~0.5 nm) that ETA at the plan's speed drops under 120 s.
      window.__liveCb(window.__fix(31.9992, 34.0, { speedMs: 15.4 }));
      return { early, afterClose: window.__notifications.slice() };
    });
    expect(out.early).toBe(0);
    expect(out.afterClose.length).toBe(1);
    expect(out.afterClose[0].body).toContain('BRAVO');
  });

  test('ETA is measured against the PLANNED speed, not the live fix\'s reported groundspeed', async ({ page }) => {
    await stubWebNotify(page);
    await bootLive(page);
    const out = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.008, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      state.legs[0].flightSpeed = 15;   // slow plan: ETA from ~0.5 nm out is minutes, not seconds
      startLiveLocation();
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
      // Fast live fix (300 kt!) at the same close distance that fires in the test above at
      // the default speed -- if the fix's speed were still driving ETA, this would fire.
      window.__liveCb(window.__fix(31.9992, 34.0, { speedMs: 154 }));   // ~300 kt reported
      const atSlowPlan = window.__notifications.length;
      state.legs[0].flightSpeed = 900;   // fast plan: same distance is now seconds away
      window.__liveCb(window.__fix(31.9993, 34.0, { speedMs: 154 }));
      return { atSlowPlan, afterFastPlan: window.__notifications.slice() };
    });
    expect(out.atSlowPlan).toBe(0);          // fast FIX speed did not fire it
    expect(out.afterFastPlan.length).toBe(1); // fast PLAN speed did
  });

  test('a leg shorter than 2 minutes (planned) uses a 1-minute lead time instead', async ({ page }) => {
    await stubWebNotify(page);
    await bootLive(page);
    const out = await page.evaluate(() => {
      // A leg planned at 90 kt over 2.0 nm is 80 s total (dist/speed*3600) -- under the
      // standard 2-minute lead time, so the short-leg rule kicks in: 60 s instead of 120 s.
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.03333, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      state.legs[0].flightSpeed = 90;
      startLiveLocation();
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
      // 1.6 nm out -> ETA 64 s at the plan's 90 kt: past the short-leg's 60 s -- must NOT fire.
      window.__liveCb(window.__fix(32.00667, 34.0, { speedMs: 20 }));
      const beforeShortThreshold = window.__notifications.length;
      // 1.4 nm out -> ETA 56 s: inside the short-leg's 60 s threshold.
      window.__liveCb(window.__fix(32.01, 34.0, { speedMs: 20 }));
      return { beforeShortThreshold, afterShortThreshold: window.__notifications.slice() };
    });
    expect(out.beforeShortThreshold).toBe(0);
    expect(out.afterShortThreshold.length).toBe(1);
  });

  test('omits altitude and heading when the pilot hid the next leg\'s nav kite', async ({ page }) => {
    await stubWebNotify(page);
    await bootLive(page);
    const out = await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.00, lng: 34.00, name: 'ALPHA' },
        { lat: 32.00, lng: 34.50, name: 'BRAVO' },
        { lat: 32.00, lng: 35.00, name: 'CHARLIE' },
      ];
      syncLegs();
      state.legs[1].inboundAltitude = 5000;
      state.legs[1].hideKite = 1;   // the leg being approached has its kite hidden
      startLiveLocation();
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
      window.__liveCb(window.__fix(31.9992, 34.5, { speedMs: 15.4 }));
      return window.__notifications.slice();
    });
    // Also captures BRAVO in the same fix -- the leg-approach alert (index 0) and the
    // separate TOP alert (index 1, unconditional on kite visibility) both fire.
    expect(out.length).toBe(2);
    expect(out[0].body).toBe('Approaching BRAVO');   // no altitude/heading suffix at all
    expect(out[1].body).toBe('TOP');
  });

  test('does not repeat while still inside the ETA window for the same leg', async ({ page }) => {
    await stubWebNotify(page);
    await bootLive(page);
    const n = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.008, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      startLiveLocation();
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
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
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
      // Landing exactly on BRAVO both captures it AND satisfies its own ETA<=0 condition --
      // that alert (index 0) fires here, and so does the separate TOP alert (index 1) the
      // same capture also triggers.
      window.__liveCb(window.__fix(32.02, 34.00, { speedMs: 15.4 }));
      const afterCapture = gpsAlertLegIndex;
      // Now close enough to CHARLIE for its own ETA alert AND its own TOP capture.
      window.__liveCb(window.__fix(32.0392, 34.00, { speedMs: 15.4 }));
      return { afterCapture, notif: window.__notifications.slice() };
    });
    expect(out.afterCapture).toBe(1);
    expect(out.notif.length).toBe(4);
    expect(out.notif[0].body).toContain('BRAVO');
    expect(out.notif[1].body).toBe('TOP');
    expect(out.notif[2].body).toContain('CHARLIE');
    expect(out.notif[3].body).toBe('TOP');
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
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
      window.__liveCb(window.__fix(31.9992, 34.5, { speedMs: 15.4 }));
      // Expected heading via the SAME conversion the code uses -- magnetic, not the raw
      // true bearing geo() returns, so this doesn't hardcode a variation-dependent number.
      const expectedHdg = pad3(toMagnetic(geo(state.waypoints[1], state.waypoints[2]).brg));
      return { notif: window.__notifications.slice(), expectedHdg };
    });
    expect(out.notif.length).toBe(2);   // leg-approach (index 0) + the same capture's TOP
    expect(out.notif[0].body).toContain('BRAVO');
    expect(out.notif[0].body).toContain('5000 ft');
    expect(out.notif[0].body).not.toContain('2000 ft');
    expect(out.notif[0].body).toContain(out.expectedHdg + '°');
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
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
      window.__liveCb(window.__fix(31.9992, 34.5, { speedMs: 15.4 }));
      // Expected heading via the SAME two-step calculation the code (and the leg
      // inspector's own live readout in interact.js) both use: course -> windTriangle -> magnetic.
      const brg = geo(state.waypoints[1], state.waypoints[2]).brg;
      const w = legWindFor(state.legs[1]);
      const fx = windTriangle(brg, state.legs[1].flightSpeed, w);
      const expectedHdg = pad3(toMagnetic(fx.hdgTrue));
      const expectedPlainHdg = pad3(toMagnetic(brg));
      return { notif: window.__notifications.slice(), expectedHdg, expectedPlainHdg };
    });
    expect(out.notif.length).toBe(2);   // leg-approach (index 0) + the same capture's TOP
    // Sanity: this scenario really does produce a different number than the plain
    // course would -- otherwise the test can't tell a correct fix from a silently
    // reverted one.
    expect(out.expectedHdg).not.toBe(out.expectedPlainHdg);
    expect(out.notif[0].body).toContain(out.expectedHdg + '°');
  });

  test('omits altitude/heading on the last leg -- nothing to prep for', async ({ page }) => {
    await stubWebNotify(page);
    await bootLive(page);
    const out = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.0, lng: 34.5, name: 'BRAVO' }];
      syncLegs();
      state.legs[0].inboundAltitude = 3000;   // the only leg, being finished, not approached
      startLiveLocation();
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
      window.__liveCb(window.__fix(31.9992, 34.5, { speedMs: 15.4 }));
      return window.__notifications.slice();
    });
    expect(out.length).toBe(2);   // leg-approach (index 0) + the same capture's TOP
    expect(out[0].body).toBe('Approaching BRAVO');   // no trailing ", N ft, hdg N°" at all
    expect(out[1].body).toBe('TOP');
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
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
      window.__liveCb(window.__fix(31.9992, 34.5, { speedMs: 15.4 }));
      const expectedHdg = pad3(toMagnetic(geo(state.waypoints[1], state.waypoints[2]).brg));
      return { notif: window.__notifications.slice(), expectedHdg };
    });
    expect(out.notif.length).toBe(2);   // leg-approach (index 0) + the same capture's TOP
    expect(out.notif[0].body).not.toContain('ft');
    expect(out.notif[0].body).toContain(out.expectedHdg + '°');
  });

  test('includes the next leg\'s planned time, from the plan\'s own speed -- ignores the live fix entirely', async ({ page }) => {
    await stubWebNotify(page);
    await bootLive(page);
    const out = await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.00, lng: 34.00, name: 'ALPHA' },
        { lat: 32.00, lng: 34.50, name: 'BRAVO' },
        { lat: 32.00, lng: 35.00, name: 'CHARLIE' },
      ];
      syncLegs();
      state.legs[1].flightSpeed = 120;   // the plan's speed for BRAVO->CHARLIE
      startLiveLocation();
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
      // Reported groundspeed is wildly different from the plan -- must not affect the
      // reported time at all (route plan is the only source of truth, no fixes).
      window.__liveCb(window.__fix(31.9992, 34.5, { speedMs: 500 }));
      const expectedTime = toHMS(geo(state.waypoints[1], state.waypoints[2]).dist / 120);
      return { notif: window.__notifications.slice(), expectedTime };
    });
    expect(out.notif[0].body).toContain('next leg:');
    expect(out.notif[0].body).toContain(out.expectedTime);
  });

  test('omits the time when the next leg has no planned speed to time it with', async ({ page }) => {
    await stubWebNotify(page);
    await bootLive(page);
    const out = await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.00, lng: 34.00, name: 'ALPHA' },
        { lat: 32.00, lng: 34.50, name: 'BRAVO' },
        { lat: 32.00, lng: 35.00, name: 'CHARLIE' },
      ];
      syncLegs();
      state.legs[1].flightSpeed = 0;   // no planned speed for BRAVO->CHARLIE
      startLiveLocation();
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
      window.__liveCb(window.__fix(31.9992, 34.5, { speedMs: 15.4 }));
      return window.__notifications.slice();
    });
    // Heading is still derivable (pure geometry, no speed needed) -- only the TIME is
    // dropped, same "omit rather than guess" rule altitude/heading already follow.
    expect(out[0].body).toContain('°');
    expect(out[0].body).not.toMatch(/\d+:\d\d/);
  });
});

test.describe('TOP alert (overhead the waypoint)', () => {
  test('fires "TOP" the moment a waypoint is captured, in addition to the leg-approach alert', async ({ page }) => {
    await stubWebNotify(page);
    await bootLive(page);
    const out = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.02, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      startLiveLocation();
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
      window.__liveCb(window.__fix(32.02, 34.0, { speedMs: 15.4 }));   // lands exactly on BRAVO
      return window.__notifications.slice();
    });
    expect(out.length).toBe(2);
    expect(out[1].body).toBe('TOP');
    expect(out[1].title).toContain('TOP');
  });

  test('fires for the LAST waypoint too, not just intermediate ones', async ({ page }) => {
    await stubWebNotify(page);
    await bootLive(page);
    const out = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.0, name: 'ALPHA' }, { lat: 32.02, lng: 34.0, name: 'BRAVO' }];
      syncLegs();
      startLiveLocation();
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
      window.__liveCb(window.__fix(32.02, 34.0, { speedMs: 15.4 }));
      return window.__notifications.slice();
    });
    expect(out.some((n) => n.body === 'TOP')).toBe(true);
  });

  test('does not re-fire while lingering at the same waypoint -- the pointer has already moved on', async ({ page }) => {
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
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
      window.__liveCb(window.__fix(32.02, 34.00, { speedMs: 15.4 }));
      window.__liveCb(window.__fix(32.02, 34.00, { speedMs: 15.4 }));   // same fix again
      window.__liveCb(window.__fix(32.02, 34.00, { speedMs: 15.4 }));
      return window.__notifications.filter((n) => n.body === 'TOP').length;
    });
    expect(out).toBe(1);
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
      // See the identical comment at startLiveLocation() above.
      window._gpsAlertConfirmed = true;
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
      // See the identical comment at startLiveLocation() above.
      window._gpsAlertConfirmed = true;
      window.__recCb(window.__fix(32.05, 34.0, { altM: ftToM(9000), speedMs: 20 }));   // wildly off any sane plan
      return window.__notifications.length;
    });
    expect(n).toBe(0);
  });
});

test.describe('confirmation gate (no alerting off an unconfirmed snap)', () => {
  // gpsSnapLegAlertsToPosition() (a fresh GPS start mid-route, a resumed session, a route
  // loaded mid-flight) infers gpsAlertLegIndex from an along-track projection alone -- a
  // reasonable guess, not ground truth. Requested live: "it should not start alerting
  // until a good fix is on a known waypoint top" -- every alert type stays silent until a
  // fix has actually landed within capture radius of a real waypoint.
  const WPS = [
    { lat: 32.00, lng: 34.00, name: 'ALPHA' },
    { lat: 32.00, lng: 34.10, name: 'BRAVO' },
    { lat: 32.00, lng: 34.20, name: 'CHARLIE' },
    { lat: 32.00, lng: 34.30, name: 'DELTA' },
  ];

  test('an unconfirmed snap onto a mid-route leg stays silent even with a real altitude deviation', async ({ page }) => {
    await stubWebNotify(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsCheckLegAlerts === 'function' &&
      typeof gpsSnapLegAlertsToPosition === 'function');
    const out = await page.evaluate((wps) => {
      state.waypoints = wps;
      syncLegs();
      state.legs[1].inboundAltitude = 3000;   // BRAVO->CHARLIE
      // Starting mid-route: a fix well inside leg 1, never having touched a waypoint --
      // exactly a fresh GPS start, a resumed session, or a mid-flight route load.
      gpsOwn = { lat: 32.00, lng: 34.15, hdg: 90, t: Date.now() };
      gpsSnapLegAlertsToPosition();
      const legAfterSnap = gpsAlertLegIndex;
      gpsLastAlt = 3300;   // 300 ft over BRAVO->CHARLIE's plan -- a real deviation
      gpsCheckLegAlerts();
      return { legAfterSnap, notif: window.__notifications.slice() };
    }, WPS);
    expect(out.legAfterSnap).toBe(1);      // snap itself is correct...
    expect(out.notif.length).toBe(0);      // ...but nothing fires: unconfirmed
  });

  test('the first real waypoint capture confirms it, and normal alerting resumes from there', async ({ page }) => {
    await stubWebNotify(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsCheckLegAlerts === 'function' &&
      typeof gpsSnapLegAlertsToPosition === 'function');
    const out = await page.evaluate((wps) => {
      state.waypoints = wps;
      syncLegs();
      state.legs[1].inboundAltitude = 3000;   // BRAVO->CHARLIE
      state.legs[2].inboundAltitude = 3000;   // CHARLIE->DELTA
      gpsOwn = { lat: 32.00, lng: 34.15, hdg: 90, t: Date.now() };
      gpsSnapLegAlertsToPosition();
      gpsLastAlt = 3300;                      // deviated on leg 1, but still unconfirmed
      gpsCheckLegAlerts();
      const beforeCapture = window.__notifications.length;
      // Fly on to CHARLIE -- captures it (within radius), confirming the pointer for real.
      gpsOwn = { lat: 32.00, lng: 34.20, hdg: 90, t: Date.now() };
      gpsCheckLegAlerts();
      const legAfterCapture = gpsAlertLegIndex;
      const afterCapture = window.__notifications.length;
      // Now on leg 2 (CHARLIE->DELTA), confirmed -- a fresh deviation here must alert.
      gpsLastAlt = 3300;                      // 300 ft over CHARLIE->DELTA's plan too
      gpsCheckLegAlerts();
      return { beforeCapture, legAfterCapture, afterCapture, notif: window.__notifications.slice() };
    }, WPS);
    expect(out.beforeCapture).toBe(0);        // still silent right up to the real capture
    expect(out.legAfterCapture).toBe(2);      // pointer advanced past BRAVO->CHARLIE
    expect(out.afterCapture).toBeGreaterThan(0);   // TOP fires now -- confirmed as of this capture
    expect(out.notif.some((n) => n.body.includes('3300'))).toBe(true);   // and the leg-2 deviation alerts too
  });

  test('a "passed abeam without ever getting close" advance does not confirm on its own', async ({ page }) => {
    await stubWebNotify(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof gpsCheckLegAlerts === 'function' &&
      typeof gpsSnapLegAlertsToPosition === 'function');
    const out = await page.evaluate((wps) => {
      state.waypoints = wps;
      syncLegs();
      gpsOwn = { lat: 32.00, lng: 34.15, hdg: 90, t: Date.now() };
      gpsSnapLegAlertsToPosition();
      // Wildly off-track, well clear of BRAVO/CHARLIE's own capture radius the whole time --
      // still triggers the "distance now growing" advance, but never actually got close.
      gpsOwn = { lat: 33.00, lng: 34.15, hdg: 90, t: Date.now() };
      gpsCheckLegAlerts();
      const legIndex = gpsAlertLegIndex;
      gpsOwn = { lat: 34.00, lng: 34.15, hdg: 90, t: Date.now() };   // even further off and away
      gpsCheckLegAlerts();
      return { legIndex, legIndexAfter: gpsAlertLegIndex, notif: window.__notifications.slice() };
    }, WPS);
    expect(out.legIndex).toBeGreaterThanOrEqual(1);   // the pointer DID advance...
    expect(out.notif.length).toBe(0);                 // ...but never confirmed, so silent throughout
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
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
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
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
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
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
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
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
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
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
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
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
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
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
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
      window._gpsAlertConfirmed = true;   // testing the drift math itself, not the confirmation gate
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
      window._gpsAlertConfirmed = true;   // testing the drift math itself, not the confirmation gate
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
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
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
      // See the identical comment at startLiveLocation() above.
      window._gpsAlertConfirmed = true;
      startLiveLocation();
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
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

  test('the check interval scales with a connected simulator\'s reported speed_factor', async ({ page }) => {
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof simStart === 'function' && typeof startLiveLocation === 'function');
    const out = await page.evaluate(async () => {
      const delays = [];
      const realSetTimeout = window.setTimeout;
      // Records the requested delay without actually scheduling anything real -- a bare id
      // is enough for gpsMaybeStopDriftTimer's own clearTimeout(_gpsDriftTimer) not to throw.
      window.setTimeout = (fn, ms) => { delays.push(ms); return 999; };

      startLiveLocation();               // real GPS: always the standard 2-minute cadence
      const liveDelay = delays[0];
      stopLiveLocation();

      delays.length = 0;
      window.simSpeedFactor = 10;        // set before simStart() -- same as a poll already
      // gpsMaybeStartDriftTimer() schedules BEFORE simStart()'s own _simFetch() call, whose
      // _simAbort(900) also goes through this same stubbed setTimeout -- delays[0] is the
      // drift timer's; a later index would be that unrelated abort timeout instead.
      simStart();
      // See the identical comment at startLiveLocation() above.
      window._gpsAlertConfirmed = true;
      const simDelay = delays[0];

      window.setTimeout = realSetTimeout;
      return { liveDelay, simDelay };
    });
    expect(out.liveDelay).toBe(120000);        // unscaled: 2 real minutes
    expect(out.simDelay).toBe(12000);          // 120000 / 10
  });
});

test.describe('loading a route while already tracking (applyRouteData)', () => {
  test('snaps the leg pointer to the nearest leg of the NEW route, but does not alert until a real waypoint confirms it', async ({ page }) => {
    // Loading a route mid-flight snaps from an inferred along-track projection, same as
    // a fresh GPS start onto an existing route -- an educated guess, not ground truth.
    // Alerting off it immediately used to fire the moment a route loaded (this test's own
    // former name: "and checks immediately"); now it waits for the confirmation gate like
    // every other start path, so a bad snap on load can't produce a false alarm before the
    // pilot has had a chance to notice the pointer is wrong.
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
      gpsLastAlt = 3200;   // 200 ft over BRAVO->CHARLIE's plan -- but nothing has confirmed the snap yet

      applyRouteData(data);
      return { legIndex: gpsAlertLegIndex, notif: window.__notifications.slice() };
    });
    expect(out.legIndex).toBe(1);        // snapped straight to the BRAVO->CHARLIE leg
    expect(out.notif.length).toBe(0);    // but nothing fired yet -- unconfirmed (see the
    // dedicated "confirmation gate" describe block for what happens once a real waypoint
    // capture does confirm it).
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
      // See the identical comment at startLiveLocation() above.
      window._gpsAlertConfirmed = true;
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
      // Not testing the confirmation gate itself here -- see the dedicated
      // "confirmation gate" describe block for that. Every other test's fix is a
      // manufactured scenario, not a real waypoint capture, so bypass it directly.
      window._gpsAlertConfirmed = true;
      // Real GPS says we're far from BRAVO, low and slow -- if the sim poll below were
      // allowed through, gpsOwn/gpsLastGS/gpsLastAlt would flip to ITS numbers instead.
      window.__liveCb(window.__fix(31.90, 34.0, { speedMs: 10, altM: 100 }));
      const beforeSim = { lat: gpsOwn.lat, gs: Math.round(gpsLastGS), alt: Math.round(gpsLastAlt) };
      simStart();
      // See the identical comment at startLiveLocation() above.
      window._gpsAlertConfirmed = true;
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
      // See the identical comment at startLiveLocation() above.
      window._gpsAlertConfirmed = true;
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

  test('restarting the simulator SNAPS to wherever the aircraft actually is, not a blind reset to leg 0', async ({ page }) => {
    // Regression: simStart() used to call gpsResetLegAlerts() unconditionally -- a
    // blind reset to leg 0 -- on every start, including reconnecting/resuming while
    // the aircraft's real position never went anywhere (a page reload mid-flight; the
    // user just toggling the connection). The very next poll then compared the REAL,
    // far-along altitude against leg 0's stale planned altitude before the old
    // "passed abeam" TOP logic had a chance to catch the pointer back up -- reported
    // live: "it said 1500 planned 800, planned is 1500" (aircraft genuinely on a
    // later leg; a route whose early legs planned 800 ft and later ones 1500 ft).
    // gpsSnapLegAlertsToPosition() -- already used for the SIM_DISCONTINUITY_NM
    // restart case below -- is the correct tool for BOTH directions of desync.
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
      state.legs[0].inboundAltitude = 800;
      state.legs[1].inboundAltitude = 1500;
      // Already established on leg 1 (BRAVO->CHARLIE), well clear of BRAVO's own
      // capture radius, at leg 1's own planned 1500 ft -- set directly rather than
      // flown-to via simStart()+_simFetch(), which (correctly, per the alt-check-
      // before-TOP-advance ordering within a single tick) would flag a real deviation
      // for a fix arriving AT BRAVO already reporting leg 1's altitude instead of
      // leg 0's -- a different, unrelated characteristic of gpsCheckLegAlerts, not
      // what this test is about.
      window.gpsOwn = { lat: 32.03, lng: 34.00, hdg: 0, t: Date.now() };
      window.gpsAlertLegIndex = 1;
      const midFlight = { leg: gpsAlertLegIndex, notifCount: window.__notifications.length };
      // Reconnect -- same last-known position, nothing moved (a page reload
      // mid-flight, or just toggling the connection) -- simStart()'s own snap must
      // use THAT position, not fire a false alarm against leg 0's stale 800 ft target.
      window.fetch = () => Promise.resolve({ ok: true, status: 200,
        json: async () => ({ latitude: 32.03, longitude: 34.00, altitude: 1500, heading: 0, ias: 30 }) });
      simStart();
      // See the identical comment at startLiveLocation() above.
      window._gpsAlertConfirmed = true;
      const afterRestart = { leg: gpsAlertLegIndex, notifCount: window.__notifications.length };
      await _simFetch();   // same position/altitude as the snap -- no real movement either
      const afterPoll = { leg: gpsAlertLegIndex, notifCount: window.__notifications.length };
      return { midFlight, afterRestart, afterPoll, all: window.__notifications.slice() };
    });
    expect(out.midFlight.leg).toBe(1);
    expect(out.afterRestart.leg).toBe(1);      // NOT reset to 0
    expect(out.afterPoll.leg).toBe(1);
    // No false "1500 ft, planned 800 ft" alarm anywhere in this sequence.
    expect(out.all.some((n) => n.body.includes('800'))).toBe(false);
  });

  test('simStart() snaps to leg 0 when the last known position genuinely is near the route start', async ({ page }) => {
    // The other direction of the same fix: gpsSnapLegAlertsToPosition() must still
    // resolve to leg 0 when that is genuinely where the aircraft is (not just fall
    // through to some other leg because a blind reset no longer runs). gpsOwn is set
    // directly here -- what simStart() actually reads is "whatever the last known
    // position was at reconnect time", regardless of how it got there (a real fix, a
    // sim poll, or -- as in production -- the SIM_DISCONTINUITY_NM jump-detection
    // logic in _simFetch already having re-snapped gpsOwn earlier in the same session
    // after a bridge process restart; that mechanism is unchanged and tested
    // separately below).
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof simStart === 'function' &&
      typeof gpsCheckLegAlerts === 'function');
    const leg = await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.00, lng: 34.00, name: 'ALPHA' },
        { lat: 32.02, lng: 34.00, name: 'BRAVO' },
        { lat: 32.04, lng: 34.00, name: 'CHARLIE' },
      ];
      syncLegs();
      window.gpsOwn = { lat: 32.001, lng: 34.00, hdg: 0, t: Date.now() };
      window.fetch = () => new Promise(() => {});   // simStart()'s own internal poll never resolves in this test
      simStart();
      // See the identical comment at startLiveLocation() above.
      window._gpsAlertConfirmed = true;
      return gpsAlertLegIndex;
    });
    expect(leg).toBe(0);
  });

  test('an implausible position jump (the bridge process restarting mid-session) re-snaps the leg pointer', async ({ page }) => {
    await stubWebNotify(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof _simFetch === 'function' &&
      typeof gpsCheckLegAlerts === 'function');
    const out = await page.evaluate(async () => {
      // Realistic route scale (~12-18 nm legs), so the "restart" jump back to near ALPHA
      // is unambiguously implausible for one poll, not just barely over the threshold.
      state.waypoints = [
        { lat: 32.00, lng: 34.00, name: 'ALPHA' },
        { lat: 32.20, lng: 34.00, name: 'BRAVO' },
        { lat: 32.50, lng: 34.00, name: 'CHARLIE' },
      ];
      syncLegs();
      simStart();
      // See the identical comment at startLiveLocation() above.
      window._gpsAlertConfirmed = true;
      // Advance the pointer to leg 1 (targeting CHARLIE), same as a session that's made
      // real progress along the route.
      window.fetch = () => Promise.resolve({ ok: true, status: 200,
        json: async () => ({ latitude: 32.20, longitude: 34.00, altitude: 2000, heading: 0, ias: 30 }) });
      await _simFetch();
      const beforeRestart = gpsAlertLegIndex;
      // The bridge process restarts -- position snaps back near ALPHA -- WITHOUT NavAid's
      // own simStop()/simStart() ever being called (no Disconnect/Connect click; the
      // browser-side poll just keeps running against the same, now-reset, server).
      window.fetch = () => Promise.resolve({ ok: true, status: 200,
        json: async () => ({ latitude: 32.001, longitude: 34.00, altitude: 800, heading: 0, ias: 30 }) });
      await _simFetch();
      const afterRestart = gpsAlertLegIndex;
      return { beforeRestart, afterRestart };
    });
    expect(out.beforeRestart).toBe(1);
    expect(out.afterRestart).toBe(0);   // re-snapped to leg 0 (ALPHA->BRAVO), not stuck on leg 1
  });

  test('a normal poll-to-poll movement does NOT trigger a re-snap', async ({ page }) => {
    await stubWebNotify(page);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof _simFetch === 'function' &&
      typeof gpsCheckLegAlerts === 'function');
    const out = await page.evaluate(async () => {
      state.waypoints = [
        { lat: 32.00, lng: 34.00, name: 'ALPHA' },
        { lat: 32.02, lng: 34.00, name: 'BRAVO' },
        { lat: 32.20, lng: 34.00, name: 'CHARLIE' },
      ];
      syncLegs();
      simStart();
      // See the identical comment at startLiveLocation() above.
      window._gpsAlertConfirmed = true;
      window.fetch = () => Promise.resolve({ ok: true, status: 200,
        json: async () => ({ latitude: 32.02, longitude: 34.00, altitude: 2000, heading: 0, ias: 30 }) });
      await _simFetch();
      const afterCapture = gpsAlertLegIndex;
      // A normal, small poll-to-poll advance along leg 1 -- must NOT be mistaken for a
      // restart and re-snapped back to leg 0.
      window.fetch = () => Promise.resolve({ ok: true, status: 200,
        json: async () => ({ latitude: 32.03, longitude: 34.00, altitude: 2000, heading: 0, ias: 30 }) });
      await _simFetch();
      return { afterCapture, afterSmallMove: gpsAlertLegIndex };
    });
    expect(out.afterCapture).toBe(1);
    expect(out.afterSmallMove).toBe(1);
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
      // See the identical comment at startLiveLocation() above.
      window._gpsAlertConfirmed = true;
      window.fetch = () => Promise.resolve({ ok: true, status: 200,
        json: async () => ({ latitude: 31.9992, longitude: 34.0, altitude: 2000, heading: 0, ias: 30 }) });
      await _simFetch();
      return window.__notifications.slice();
    });
    expect(out.length).toBe(1);
    expect(out[0].body).toContain('BRAVO');
  });
});
