// @ts-check
// Two findings from the full-codebase review that a pilot could act on in flight: an MSA
// computed from partial terrain data, and a frozen GPS fix drawn as a live position.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof legMsaFt === 'function' && typeof terrainMaxAlongLeg === 'function');
}

// A grid covering ONLY 31–33N / 34–36E. Terrain outside it is unknown, not flat.
const GRID = { coverage: true, units: 'm', south: 31, west: 34, north: 33, east: 36,
  rows: 1, cols: 1, data: [[1000]] };

test('a leg leaving terrain coverage has NO MSA, not a partial one', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(({ grid }) => {
    terrainGrid = grid;
    const inside = { lat: 32.0, lng: 34.8 };
    const outside = { lat: 33.9, lng: 36.6 };      // beyond the grid's north-east corner
    // Both endpoints inside is the covered case and must still answer.
    state.waypoints = [inside, { lat: 32.3, lng: 35.0 }];
    state.legs = []; syncLegs();
    const covered = legMsaFt(0);
    // One endpoint outside: the samples that ARE known used to be maxed and returned, so the
    // highest terrain we happen to have data for was reported as the highest terrain there is.
    state.waypoints = [inside, outside];
    state.legs = []; syncLegs();
    return { covered, partial: legMsaFt(0),
      partialMax: terrainMaxAlongLeg(inside, outside),
      outsideSample: terrainMaxAtLatLng(outside.lat, outside.lng) };
  }, { grid: GRID });
  expect(r.covered).toBe(4300);          // fully covered still works
  expect(r.outsideSample).toBeNull();    // the far end really is out of coverage
  // No MSA at all rather than one derived from half a leg. The leg inspector hides the row
  // when this is null, and — the reason it matters — it can no longer clear its below-MSA
  // flag on the strength of a number that is too low.
  expect(r.partialMax).toBeNull();
  expect(r.partial).toBeNull();
});

test('a hole in the terrain data voids the leg too', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    // Two cells, one with no value: unknown terrain inside the box is still unknown.
    terrainGrid = { coverage: true, units: 'ft', south: 31, west: 34, north: 33, east: 36,
      rows: 1, cols: 2, data: [[900, null]] };
    state.waypoints = [{ lat: 32.0, lng: 34.5 }, { lat: 32.0, lng: 35.5 }];
    state.legs = []; syncLegs();
    return legMsaFt(0);
  });
  expect(r).toBeNull();
});

// --- gps.js: a frozen fix must not be presented as live ------------------------------
test('a stale GPS fix is reported as stale and drawn faded', async ({ page }) => {
  await page.addInitScript(() => {
    // Capture the watch callback so fixes can be delivered with a chosen timestamp.
    const g = navigator.geolocation || {};
    g.watchPosition = (cb) => { window.__geoCb = cb; return 1; };
    g.clearWatch = () => {};
    Object.defineProperty(navigator, 'geolocation', { value: g, configurable: true });
  });
  await boot(page);
  const r = await page.evaluate(() => {
    startLiveLocation();
    const fix = ageMs => window.__geoCb({
      coords: { latitude: 32.0, longitude: 34.9, accuracy: 8, heading: 90, altitude: 300 },
      timestamp: Date.now() - ageMs });
    fix(0);
    const fresh = { stale: gpsFixStale(), age: gpsFixAgeMs(), hasT: Number.isFinite(gpsOwn.t) };
    // The same position delivered with an old timestamp: this is what a resumed WebView or a
    // cached platform fix looks like. Nothing used to read pos.timestamp at all.
    fix(120000);
    const old = { stale: gpsFixStale(), age: gpsFixAgeMs() };
    gpsUpdateReadout();
    const readout = (document.getElementById('gps-readout') || {}).textContent || '';
    return { fresh, old, readout };
  });
  expect(r.fresh.hasT).toBe(true);        // the fix time is recorded at all
  expect(r.fresh.stale).toBe(false);
  expect(r.old.stale).toBe(true);
  expect(r.old.age).toBeGreaterThan(60000);
  expect(r.readout).toMatch(/GPS fix/);   // ...and the pilot is told, not left guessing
});

test('the heading predictor is not extrapolated from a frozen fix', async ({ page }) => {
  await page.addInitScript(() => {
    const g = navigator.geolocation || {};
    g.watchPosition = (cb) => { window.__geoCb = cb; return 1; };
    g.clearWatch = () => {};
    Object.defineProperty(navigator, 'geolocation', { value: g, configurable: true });
  });
  await boot(page);
  const r = await page.evaluate(() => {
    startLiveLocation();
    const fix = ageMs => window.__geoCb({
      coords: { latitude: 32.0, longitude: 34.9, accuracy: 8, heading: 90, altitude: 300 },
      timestamp: Date.now() - ageMs });
    // Count heading-line draws by wrapping the function the own-ship path calls.
    const realHeadingLine = window.drawHeadingLine;
    let calls = 0;
    window.drawHeadingLine = function (...args) { calls++; return realHeadingLine.apply(this, args); };
    fix(0); drawOwnShip(gpsOwn, gpsOwn.hdg);
    const fresh = calls;
    fix(120000); calls = 0; drawOwnShip(gpsOwn, gpsOwn.hdg);
    const stale = calls;
    window.drawHeadingLine = realHeadingLine;
    return { fresh, stale };
  });
  expect(r.fresh).toBeGreaterThan(0);     // a live fix still gets its predictor
  // Drawing a track ahead of a position that stopped updating is the one thing a stale fix
  // must not do — it points confidently at where the aircraft is no longer going.
  expect(r.stale).toBe(0);
});

test('the web watch asks the platform to time out', async ({ page }) => {
  await page.addInitScript(() => {
    const g = navigator.geolocation || {};
    g.watchPosition = (cb, err, opts) => { window.__geoOpts = opts; return 1; };
    g.clearWatch = () => {};
    Object.defineProperty(navigator, 'geolocation', { value: g, configurable: true });
  });
  await boot(page);
  const opts = await page.evaluate(() => { startLiveLocation(); return window.__geoOpts; });
  // Without a timeout a watch that stops delivering simply goes quiet: the error handler is
  // never called, so nothing else in the app would ever learn the position had gone.
  expect(opts).toMatchObject({ enableHighAccuracy: true });
  expect(opts.timeout).toBeGreaterThan(0);
  expect(opts.maximumAge).toBe(0);
});
