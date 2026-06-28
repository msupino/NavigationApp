const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && typeof simplifyTrack === 'function');
}

test('simplifyTrack reduces collinear points and keeps the endpoints', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const pts = [
      { lat: 32.00, lng: 34.00 }, { lat: 32.01, lng: 34.00 },
      { lat: 32.02, lng: 34.00 }, { lat: 32.03, lng: 34.00 }, // collinear N
      { lat: 32.03, lng: 34.05 },                              // sharp turn E
    ];
    const s = simplifyTrack(pts, 0.0003);
    return { n: s.length, first: s[0], last: s[s.length - 1] };
  });
  expect(out.n).toBeLessThan(5);
  expect(out.n).toBeGreaterThanOrEqual(3);
  expect(out.first).toMatchObject({ lat: 32.00, lng: 34.00 });
  expect(out.last).toMatchObject({ lat: 32.03, lng: 34.05 });
});

test('simplifyTrack handles a very large input without overflowing', async ({ page }) => {
  test.setTimeout(10000); // iterative D-P on 20k-point worst-case zigzag runs in ~2-3 s
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof simplifyTrack === 'function');
  const out = await page.evaluate(() => {
    // 20k-point zigzag: exceeds ~15k recursion-overflow threshold, guards the iterative path.
    const pts = [];
    for (let i = 0; i < 20000; i++) pts.push({ lat: 32 + i * 1e-5, lng: 34 + (i % 2) * 1e-3 });
    const s = simplifyTrack(pts, 0.0003);
    return { n: s.length, first: s[0], last: s[s.length - 1] };
  });
  expect(out.n).toBeGreaterThan(2);
  expect(out.first).toMatchObject({ lat: 32, lng: 34 });
});

test('readout shows realtime ground speed + altitude while recording', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 7; };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof startGpsRecording === 'function');
  await page.evaluate(() => {
    startGpsRecording();
    // speed 50 m/s ≈ 97 kt; altitude 304.8 m = 1000 ft.
    window.__geoCb({ coords: { latitude: 32.0, longitude: 34.0, accuracy: 8, heading: null, speed: 50, altitude: 304.8 }, timestamp: Date.now() });
  });
  const readout = page.locator('#gps-readout');
  await expect(readout).toContainText('97 kt');
  await expect(readout).toContainText('1000 ft');
  // Stopping clears the live values.
  await page.evaluate(() => stopGpsRecording());
  await expect(readout).toHaveText('');
});

test('recording collects filtered fixes and stops cleanly', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoCb = null; window.__cleared = 0;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 42; };
    navigator.geolocation.clearWatch = () => { window.__cleared++; };
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof startGpsRecording === 'function');
  const fed = await page.evaluate(() => {
    startGpsRecording();
    const fix = (lat, lng, acc) => window.__geoCb({ coords: { latitude: lat, longitude: lng, accuracy: acc, heading: null, altitude: null }, timestamp: Date.now() });
    fix(32.0000, 34.0000, 8);    // kept
    fix(32.00001, 34.00001, 8);  // < 10 m from prev -> dropped
    fix(32.0100, 34.0000, 8);    // kept (moved ~1.1 km)
    fix(32.0200, 34.0000, 250);  // accuracy > 100 -> dropped
    return { recording: gpsRecording, n: gpsTrack.length };
  });
  expect(fed.recording).toBe(true);
  expect(fed.n).toBe(2);
  const after = await page.evaluate(() => { stopGpsRecording(); return { recording: gpsRecording, cleared: window.__cleared, watch: gpsWatchId }; });
  expect(after.recording).toBe(false);
  expect(after.cleared).toBe(1);
  expect(after.watch).toBeNull();
});

test('stop saves a kind:gps library entry with simplified route + raw track', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 7; };
    navigator.geolocation.clearWatch = () => {};
    try { localStorage.removeItem('navaid.routes'); } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof stopGpsRecordingAndSave === 'function');
  await page.evaluate(() => {
    startGpsRecording();
    const fix = (lat, lng) => window.__geoCb({ coords: { latitude: lat, longitude: lng, accuracy: 8, heading: null, altitude: 100 }, timestamp: Date.now() });
    fix(32.00, 34.00); fix(32.05, 34.00); fix(32.10, 34.02); fix(32.15, 34.10);
  });
  const entry = await page.evaluate(() => stopGpsRecordingAndSave());
  expect(entry).toBeTruthy();
  expect(entry.kind).toBe('gps');
  expect(entry.name).toMatch(/^Track /);
  expect(Array.isArray(entry.track)).toBe(true);
  expect(entry.track.length).toBeGreaterThanOrEqual(4);
  expect(entry.data.waypoints.length).toBeGreaterThanOrEqual(2);
  expect(entry.data.legs.length).toBe(entry.data.waypoints.length - 1);
  // Fix: saved GPS entry must not be polluted with user's current wind or suppressions.
  expect(entry.data.commChangeSuppressions || []).toEqual([]);
  expect(entry.data.wind == null || (entry.data.wind.speed === 0)).toBe(true);
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.routes'))[0]);
  expect(persisted.id).toBe(entry.id);
  expect(await page.evaluate((d) => (typeof validateRoute === 'function' ? validateRoute(d) : null), entry.data)).toBeNull();
});

test('breadcrumb + own-ship are drawn while recording', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 1; };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof startGpsRecording === 'function' && typeof drawGpsTrack === 'function');
  const drawn = await page.evaluate(() => {
    window.__gpsBreadcrumbDrawn = 0;
    startGpsRecording();
    const fix = (lat, lng) => window.__geoCb({ coords: { latitude: lat, longitude: lng, accuracy: 8, heading: 90, altitude: null }, timestamp: Date.now() });
    fix(32.05, 34.80); fix(32.06, 34.81); fix(32.07, 34.82);
    draw();
    return { points: gpsTrack.length, ownHdg: gpsOwn && gpsOwn.hdg, breadcrumb: window.__gpsBreadcrumbDrawn };
  });
  expect(drawn.points).toBe(3);
  expect(drawn.ownHdg).toBe(90);
  expect(drawn.breadcrumb).toBeGreaterThan(0);
});

test('toolbar GPS button toggles recording and updates its label', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 5; };
    navigator.geolocation.clearWatch = () => {};
    try { localStorage.removeItem('navaid.routes'); } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof startGpsRecording === 'function');
  const btn = page.locator('#gps-record');
  await expect(btn).toHaveCount(1);
  await expect(btn).toBeVisible();
  await btn.click();
  expect(await page.evaluate(() => gpsRecording)).toBe(true);
  await expect(btn).toContainText('Stop');
  await page.evaluate(() => { const f=(a,b)=>window.__geoCb({coords:{latitude:a,longitude:b,accuracy:8,heading:null,altitude:null},timestamp:Date.now()}); f(32.0,34.0); f(32.1,34.0); });
  await btn.click();
  expect(await page.evaluate(() => gpsRecording)).toBe(false);
  await expect(btn).toContainText('Record');
});

test('saving a GPS track does not mutate the currently-loaded routes legs', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 3; };
    navigator.geolocation.clearWatch = () => {};
    try { localStorage.removeItem('navaid.routes'); } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof stopGpsRecordingAndSave === 'function');
  const before = await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.2, lng: 34.9, name: 'B' }, { lat: 32.4, lng: 35.0, name: 'C' },
    ];
    syncLegs();
    state.legs[0].flightSpeed = 137;            // custom edit on a leg
    state.legs[1].inboundAltitude = 4500;
    draw();
    startGpsRecording();
    const f = (a, b) => window.__geoCb({ coords: { latitude: a, longitude: b, accuracy: 8, heading: null, altitude: null }, timestamp: Date.now() });
    f(31.0, 34.0); f(31.5, 34.2); f(31.9, 34.6);
    return { speed: state.legs[0].flightSpeed, alt: state.legs[1].inboundAltitude, nLegs: state.legs.length };
  });
  await page.evaluate(() => stopGpsRecordingAndSave());
  const after = await page.evaluate(() => ({ speed: state.legs[0].flightSpeed, alt: state.legs[1].inboundAltitude, nLegs: state.legs.length, wps: state.waypoints.map(w => w.name) }));
  expect(after.nLegs).toBe(before.nLegs);          // 2 legs, not regrown/truncated
  expect(after.speed).toBe(137);                   // custom speed preserved
  expect(after.alt).toBe(4500);                    // custom altitude preserved
  expect(after.wps).toEqual(['A', 'B', 'C']);      // live waypoints untouched
});

test('GPS error resets recording state and button label', async ({ page }) => {
  await page.addInitScript(() => {
    window.__errCb = null;
    navigator.geolocation.watchPosition = (cb, err) => { window.__errCb = err; return 9; };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof startGpsRecording === 'function');
  page.on('dialog', d => d.dismiss().catch(() => {}));   // swallow the alert
  const btn = page.locator('#gps-record');
  await btn.click();
  expect(await page.evaluate(() => gpsRecording)).toBe(true);
  await page.evaluate(() => window.__errCb && window.__errCb({ code: 1, message: 'denied' }));
  expect(await page.evaluate(() => gpsRecording)).toBe(false);
  await expect(btn).toContainText('Record');
});

test('Show my location shows own-ship without recording or saving a track', async ({ page }) => {
  await page.addInitScript(() => {
    window.__liveCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__liveCb = cb; return 11; };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof startLiveLocation === 'function');
  const btn = page.locator('#gps-live');
  await expect(btn).toBeVisible();
  await btn.click();
  const st = await page.evaluate(() => {
    const f = (a, b) => window.__liveCb({ coords: { latitude: a, longitude: b, accuracy: 8, heading: 45, altitude: null }, timestamp: Date.now() });
    f(32.0, 34.8); f(32.1, 34.9);
    draw();
    return { live: gpsLiveOn, recording: gpsRecording, track: gpsTrack.length, own: gpsOwn && gpsOwn.hdg };
  });
  expect(st.live).toBe(true);
  expect(st.recording).toBe(false);   // NOT recording
  expect(st.track).toBe(0);           // NOT collecting a track
  expect(st.own).toBe(45);            // own-ship updated
  expect(await page.evaluate(() => localStorage.getItem('navaid.routes'))).toBeNull(); // nothing saved
  await btn.click();
  expect(await page.evaluate(() => gpsLiveOn)).toBe(false);
  expect(await page.evaluate(() => gpsOwn)).toBeNull(); // own-ship cleared (no recording active)
});

test('stopping a recording keeps own-ship when live location is still on', async ({ page }) => {
  await page.addInitScript(() => {
    window.__recCb = null; window.__liveCb = null; let n = 0;
    navigator.geolocation.watchPosition = (cb) => { n++; if (n === 1) window.__recCb = cb; else window.__liveCb = cb; return n; };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof startGpsRecording === 'function' && typeof startLiveLocation === 'function');
  const out = await page.evaluate(() => {
    startGpsRecording();                 // watch #1 -> __recCb
    startLiveLocation();                 // watch #2 -> __liveCb
    window.__recCb({ coords: { latitude: 32.0, longitude: 34.8, accuracy: 8, heading: 10, altitude: null }, timestamp: Date.now() });
    window.__liveCb({ coords: { latitude: 32.1, longitude: 34.9, accuracy: 8, heading: 20, altitude: null }, timestamp: Date.now() });
    stopGpsRecordingAndSave();           // stop recording; live still on
    return { live: gpsLiveOn, recording: gpsRecording, ownAfter: gpsOwn };
  });
  expect(out.recording).toBe(false);
  expect(out.live).toBe(true);
  expect(out.ownAfter).not.toBeNull();   // own-ship preserved because live is on
});

test('GPS error resets the live-location button too', async ({ page }) => {
  await page.addInitScript(() => {
    window.__errCb = null;
    navigator.geolocation.watchPosition = (cb, err) => { window.__errCb = err; return 4; };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof startLiveLocation === 'function');
  page.on('dialog', d => d.dismiss().catch(() => {}));
  const btn = page.locator('#gps-live');
  await btn.click();
  expect(await page.evaluate(() => gpsLiveOn)).toBe(true);
  await page.evaluate(() => window.__errCb && window.__errCb({ code: 1, message: 'denied' }));
  expect(await page.evaluate(() => gpsLiveOn)).toBe(false);
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  await expect(btn).toContainText('Show');
});

test('recording holds a screen wake lock, releases on stop, re-arms on visibility', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 9; };
    navigator.geolocation.clearWatch = () => {};
    window.__wlReq = 0; window.__wlRel = 0; window.__wlDrop = null;
    const makeSentinel = () => {
      let onRelease = null;
      return {
        release() { window.__wlRel++; if (onRelease) onRelease(); return Promise.resolve(); },
        addEventListener(t, fn) { if (t === 'release') { onRelease = fn; window.__wlDrop = () => { window.__wlRel++; fn(); }; } },
      };
    };
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request() { window.__wlReq++; return Promise.resolve(makeSentinel()); } },
    });
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof startGpsRecording === 'function');

  await page.evaluate(() => startGpsRecording());
  await page.waitForFunction(() => window.__wlReq === 1 && gpsWakeLock != null);

  // Browser drops the lock when backgrounded; coming back to foreground re-arms it.
  await page.evaluate(() => window.__wlDrop());
  await page.waitForFunction(() => gpsWakeLock == null);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => window.__wlReq === 2 && gpsWakeLock != null);

  await page.evaluate(() => stopGpsRecording());
  await page.waitForFunction(() => gpsWakeLock == null);
  const counts = await page.evaluate(() => ({ req: window.__wlReq, rel: window.__wlRel }));
  expect(counts.req).toBe(2);   // initial + re-arm
  expect(counts.rel).toBe(2);   // OS drop + stop
});
