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

test('stop saves a kind:gps TRACK entry (a line, not a waypoint route) and shows it', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 7; };
    navigator.geolocation.clearWatch = () => {};
    try { localStorage.removeItem('navaid.routes'); localStorage.removeItem('navaid.tracks.shown'); } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof stopGpsRecordingAndSave === 'function');
  await page.evaluate(() => {
    startGpsRecording();
    const fix = (lat, lng) => window.__geoCb({ coords: { latitude: lat, longitude: lng, accuracy: 8, heading: null, altitude: 100 }, timestamp: Date.now() });
    fix(32.00, 34.00); fix(32.05, 34.00); fix(32.10, 34.02); fix(32.15, 34.10);
  });
  const r = await page.evaluate(() => {
    const e = stopGpsRecordingAndSave();
    return { entry: e, shown: typeof isTrackShown === 'function' && isTrackShown(e.id),
             wpUntouched: state.waypoints.length };
  });
  expect(r.entry.kind).toBe('gps');
  expect(r.entry.name).toMatch(/^Record - /);
  expect(Array.isArray(r.entry.track)).toBe(true);
  expect(r.entry.track.length).toBeGreaterThanOrEqual(4);
  // It's a TRACK: no synthetic waypoint route, and the working route is untouched.
  expect(r.entry.data).toBeUndefined();
  expect(r.wpUntouched).toBe(0);
  // Altitude is kept per track point (rounded ft), not on legs.
  expect(r.entry.track[0].alt).toBe(100);
  // Saved + auto-shown as an overlay.
  expect(r.shown).toBe(true);
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.routes'))[0]);
  expect(persisted.id).toBe(r.entry.id);
  const shownIds = await page.evaluate(() => JSON.parse(localStorage.getItem('navaid.tracks.shown') || '[]'));
  expect(shownIds).toContain(r.entry.id);
});

test('a recorded GPS track shows up as a row in the Saved routes library', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 7; };
    navigator.geolocation.clearWatch = () => {};
    try { localStorage.removeItem('navaid.routes'); localStorage.removeItem('navaid.tracks.shown'); } catch (e) {}
    for (const s of ['build', 'view', 'display', 'charts', 'export', 'print']) {
      try { localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
    }
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof stopGpsRecordingAndSave === 'function' &&
    typeof showRouteLibraryModal === 'function');
  const name = await page.evaluate(() => {
    startGpsRecording();
    const fix = (lat, lng) => window.__geoCb({ coords: { latitude: lat, longitude: lng, accuracy: 8, heading: null, altitude: 100 }, timestamp: Date.now() });
    fix(32.00, 34.00); fix(32.05, 34.00); fix(32.10, 34.02); fix(32.15, 34.10);
    return stopGpsRecordingAndSave().name;
  });
  // Open the Saved routes library — the GPS track (no route `data`, only
  // `track`) must appear as a row, not be filtered out.
  await page.evaluate(() => showRouteLibraryModal());
  const modal = page.locator('.route-library-modal');
  await expect(modal).toBeVisible();
  const rows = modal.locator('.route-library-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(name);
  // Track rows are read-only overlays: Show/Hide + GPX, never a route Load.
  await expect(rows.first().getByRole('button', { name: /Show|Hide/ })).toBeVisible();
  await expect(rows.first().getByRole('button', { name: 'GPX' })).toBeVisible();
  await expect(rows.first().getByRole('button', { name: 'Load', exact: true })).toHaveCount(0);
});

test('a track overlays a loaded waypoint route for actual-vs-planned comparison', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 7; };
    navigator.geolocation.clearWatch = () => {};
    try { localStorage.removeItem('navaid.routes'); localStorage.removeItem('navaid.tracks.shown'); } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof stopGpsRecordingAndSave === 'function' &&
    typeof isTrackShown === 'function');
  const id = await page.evaluate(() => {
    // A planned waypoint route is loaded and stays intact.
    state.waypoints = [{ lat: 32.0, lng: 34.85, name: 'A' }, { lat: 32.2, lng: 35.05, name: 'B' }];
    syncLegs();
    startGpsRecording();
    const fix = (lat, lng) => window.__geoCb({ coords: { latitude: lat, longitude: lng, accuracy: 8, heading: null, altitude: 100 }, timestamp: Date.now() });
    fix(32.02, 34.86); fix(32.08, 34.92); fix(32.15, 35.00); fix(32.2, 35.04);
    const e = stopGpsRecordingAndSave();   // auto-shows the overlay
    return e.id;
  });
  const r = await page.evaluate((tid) => ({
    trackShown: isTrackShown(tid),
    wpKept: state.waypoints.length,           // planned route untouched (read-only track)
  }), id);
  expect(r.trackShown).toBe(true);            // flown track overlaid
  expect(r.wpKept).toBe(2);                    // planned route intact
});

test('a saved track draws as an overlay polyline, independent of the route', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 7; };
    navigator.geolocation.clearWatch = () => {};
    try { localStorage.removeItem('navaid.routes'); localStorage.removeItem('navaid.tracks.shown'); } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof stopGpsRecordingAndSave === 'function' && typeof drawTracks === 'function');
  const out = await page.evaluate(() => {
    startGpsRecording();
    const fix = (lat, lng) => window.__geoCb({ coords: { latitude: lat, longitude: lng, accuracy: 8, heading: 90, altitude: null }, timestamp: Date.now() });
    fix(32.05, 34.80); fix(32.06, 34.81); fix(32.07, 34.82);
    stopGpsRecordingAndSave();
    // count moveTo calls issued by the overlay (one sub-path per shown track)
    let moveTos = 0;
    const orig = octx.moveTo;
    octx.moveTo = function (x, y) { moveTos++; return orig.call(this, x, y); };
    draw();
    octx.moveTo = orig;
    return { tracks: window.__tracksDrawn || 0, moveTos, shown: shownTracks.length };
  });
  expect(out.shown).toBe(1);
  expect(out.tracks).toBe(1);
  expect(out.moveTos).toBeGreaterThan(0);
});

test('showing a recorded track hides any other (one at a time) and highlights it', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('navaid.routes'); localStorage.removeItem('navaid.tracks.shown'); } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof showTrackOverlay === 'function' && typeof drawTracks === 'function');
  const out = await page.evaluate(() => {
    const mk = (id, pts) => ({ id, name: id, track: pts.map(p => ({ lat: p[0], lng: p[1], t: Date.now() })) });
    const A = mk('A', [[32.0, 34.8], [32.1, 34.9]]);
    const B = mk('B', [[31.2, 34.7], [31.3, 34.8]]);
    showTrackOverlay(A);
    const afterA = { shown: shownTracks.map(t => t.id), highlight: _trackHighlightId, active: _trackHighlightUntil > Date.now() };
    showTrackOverlay(B);
    const afterB = { shown: shownTracks.map(t => t.id), highlight: _trackHighlightId, active: _trackHighlightUntil > Date.now() };
    return { afterA, afterB };
  });
  // First shown track: highlighted + glow active.
  expect(out.afterA.shown).toEqual(['A']);
  expect(out.afterA.highlight).toBe('A');
  expect(out.afterA.active).toBe(true);
  // Showing the second replaces the first — only one at a time — and re-highlights.
  expect(out.afterB.shown).toEqual(['B']);
  expect(out.afterB.highlight).toBe('B');
  expect(out.afterB.active).toBe(true);
});

test('showing a degenerate track (<2 points) does not wipe the currently-shown one', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.removeItem('navaid.routes'); localStorage.removeItem('navaid.tracks.shown'); } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof showTrackOverlay === 'function');
  const out = await page.evaluate(() => {
    const A = { id: 'A', name: 'A', track: [[32.0, 34.8], [32.1, 34.9]].map(p => ({ lat: p[0], lng: p[1] })) };
    const bad = { id: 'BAD', name: 'BAD', track: [{ lat: 31.5, lng: 34.7 }] };   // only 1 point
    showTrackOverlay(A);
    showTrackOverlay(bad);   // must NOT clear A: nothing to draw for BAD
    return {
      shown: shownTracks.map(t => t.id),
      persisted: JSON.parse(localStorage.getItem('navaid.tracks.shown') || '[]'),
    };
  });
  expect(out.shown).toEqual(['A']);       // A still shown, BAD ignored
  expect(out.persisted).toEqual(['A']);   // and the persisted set was not blanked
});

test('the top-right REC indicator shows only while recording', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 5; };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof startGpsRecording === 'function');
  const el = page.locator('#gps-rec-indicator');
  await expect(el).toBeHidden();                       // idle: no indicator
  await page.evaluate(() => startGpsRecording());
  await expect(el).toBeVisible();                       // recording: shown
  await page.evaluate(() => stopGpsRecording());
  await expect(el).toBeHidden();                        // stopped: hidden again
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
  await expect(btn).toContainText('Stop recording');
  await page.evaluate(() => { const f=(a,b)=>window.__geoCb({coords:{latitude:a,longitude:b,accuracy:8,heading:null,altitude:null},timestamp:Date.now()}); f(32.0,34.0); f(32.1,34.0); });
  await btn.click();
  expect(await page.evaluate(() => gpsRecording)).toBe(false);
  await expect(btn).toContainText('Start recording');
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
  await expect(btn).toContainText('Start recording');
});

test('the Record button label is driven together with the REC indicator', async ({ page }) => {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 7; };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof startGpsRecording === 'function');
  const btn = page.locator('#gps-record');
  const dot = page.locator('#gps-rec-indicator');
  // Drive start/stop directly (not via the click handler): the label must
  // follow gpsRecording from updateGpsRecIndicator, in lockstep with the dot —
  // so it can't get stuck on "Start recording" while the dot is flashing.
  await page.evaluate(() => startGpsRecording());
  await expect(dot).toBeVisible();
  await expect(btn).toContainText('Stop recording');
  await page.evaluate(() => stopGpsRecording());
  await expect(dot).toBeHidden();
  await expect(btn).toContainText('Start recording');
});

test('a watch that throws on start rolls back — no phantom recording', async ({ page }) => {
  await page.addInitScript(() => {
    // Simulate a native/plugin watch registration that throws synchronously
    // (the APK symptom: red indicator on, button stuck on "Start recording").
    navigator.geolocation.watchPosition = () => { throw new Error('watch registration failed'); };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof startGpsRecording === 'function');
  page.on('dialog', d => d.dismiss().catch(() => {}));   // swallow the error alert
  const btn = page.locator('#gps-record');
  await btn.click();
  expect(await page.evaluate(() => gpsRecording)).toBe(false);   // rolled back
  await expect(page.locator('#gps-rec-indicator')).toBeHidden();  // dot cleared, not phantom-on
  await expect(btn).toContainText('Start recording');             // label consistent with state
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
