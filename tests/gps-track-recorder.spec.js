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
    try { localStorage.setItem('navaid.sec.view', '1'); } catch (e) {}
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

test('GPS error resets recording state and button label', async ({ page }) => {
  await page.addInitScript(() => {
    window.__errCb = null;
    navigator.geolocation.watchPosition = (cb, err) => { window.__errCb = err; return 9; };
    navigator.geolocation.clearWatch = () => {};
    try { localStorage.setItem('navaid.sec.view', '1'); } catch (e) {}
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
