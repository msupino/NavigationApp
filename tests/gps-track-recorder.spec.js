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
