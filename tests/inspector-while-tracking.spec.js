// @ts-check
// In flight the map is the thing being read, and the inspector covers it. A tap meant to
// check where you are — or a stray one on a kneeboard-mounted phone — used to open a
// waypoint panel over the chart. While a REAL fix is driving the own-ship (recording, or
// just showing the position) the inspector stays shut.
//
// The simulator is deliberately excluded: that is someone at a desk, where opening a
// waypoint is the point of the session.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 9; };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof startLiveLocation === 'function' &&
    typeof showInspector === 'function' && typeof syncLegs === 'function');
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.00, name: 'ALPHA' },
      { lat: 32.10, lng: 34.10, name: 'BRAVO' },
    ];
    syncLegs();
    draw();
  });
}

const inspectorHidden = (page) => page.evaluate(() =>
  document.getElementById('inspector').classList.contains('hidden'));
const selectWaypoint = (page, index) => page.evaluate((i) => {
  state.selected = { type: 'wp', index: i };
  showInspector();
}, index);

test('on the ground the inspector opens as always', async ({ page }) => {
  await boot(page);
  await selectWaypoint(page, 1);
  expect(await inspectorHidden(page)).toBe(false);
  expect(await page.evaluate(() => state.selected && state.selected.type)).toBe('wp');
});

test.describe('while a real fix drives the map', () => {
  test('showing location keeps it shut, and drops the selection with it', async ({ page }) => {
    await boot(page);
    await selectWaypoint(page, 1);
    expect(await inspectorHidden(page)).toBe(false);      // open first...
    await page.evaluate(() => {
      startLiveLocation();
      window.__geoCb({ coords: { latitude: 32.0, longitude: 34.0, accuracy: 6, speed: 40, altitude: 300, heading: 90 }, timestamp: Date.now() });
    });
    // ...and a tap while tracking neither opens it nor leaves a waypoint highlighted with
    // no panel to explain it.
    await selectWaypoint(page, 1);
    expect(await inspectorHidden(page)).toBe(true);
    expect(await page.evaluate(() => state.selected)).toBeNull();
  });

  test('recording keeps it shut too', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      startGpsRecording();
      window.__geoCb({ coords: { latitude: 32.0, longitude: 34.0, accuracy: 6, speed: 40, altitude: 300, heading: 90 }, timestamp: Date.now() });
    });
    await selectWaypoint(page, 1);
    expect(await inspectorHidden(page)).toBe(true);
    await page.evaluate(() => stopGpsRecording());
    // Back on the ground: the panel works again.
    await selectWaypoint(page, 1);
    expect(await inspectorHidden(page)).toBe(false);
  });

  test('a simulator session is left alone — that is a desk, not a cockpit', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { window.simOn = true; });
    await selectWaypoint(page, 1);
    expect(await inspectorHidden(page)).toBe(false);
    await page.evaluate(() => { window.simOn = false; });
  });

  test('the gist can put the old behaviour back', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      startLiveLocation();
      window.__geoCb({ coords: { latitude: 32.0, longitude: 34.0, accuracy: 6, speed: 40, altitude: 300, heading: 90 }, timestamp: Date.now() });
      setTune('featureInspectorWhileTracking', true);
    });
    await selectWaypoint(page, 1);
    expect(await inspectorHidden(page)).toBe(false);
    await page.evaluate(() => setTune('featureInspectorWhileTracking', false));
  });
});
