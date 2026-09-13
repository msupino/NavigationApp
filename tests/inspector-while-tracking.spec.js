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

// Reported as a bug: "on mobile the inspector does not open at all" -- when showing location.
// It was the rule above, doing its job in silence, with the only way to change it a gist key
// and no control on screen. A refusal nobody can see or undo is indistinguishable from a
// broken app, which is exactly how it was reported.
test('the refusal says so, once per tracking session', async ({ page }) => {
  await boot(page);
  const said = await page.evaluate(async () => {
    const seen = [];
    window.showToast = (m) => seen.push(String(m));
    startLiveLocation();
    window.__geoCb({ coords: { latitude: 32, longitude: 34, accuracy: 8 }, timestamp: Date.now() });
    await new Promise(r => setTimeout(r, 20));
    state.selected = { type: 'wp', index: 1 };
    showInspector();
    const first = seen.length;
    state.selected = { type: 'wp', index: 0 };
    showInspector();                       // a second stray tap must not toast again
    return { first, total: seen.length, text: seen[0] || '' };
  });
  expect(said.first).toBe(1);
  expect(said.total, 'every stray tap toasted').toBe(1);
  // It names where the switch is, because a notice about a control nobody can reach is worse
  // than silence.
  expect(said.text).toMatch(/View\/Set/i);
});

test('the switch in View\/Set opens it, and is remembered', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    startLiveLocation();
    window.__geoCb({ coords: { latitude: 32, longitude: 34, accuracy: 8 }, timestamp: Date.now() });
    await new Promise(r => setTimeout(r, 20));
    const cb = document.getElementById('insp-tracking-cb');
    const before = cb.checked;
    state.selected = { type: 'wp', index: 1 };
    showInspector();
    const shutWithout = document.getElementById('inspector').classList.contains('hidden');
    cb.checked = true;
    cb.onchange({ target: cb });
    state.selected = { type: 'wp', index: 1 };
    showInspector();
    return { before, shutWithout,
             open: !document.getElementById('inspector').classList.contains('hidden'),
             stored: localStorage.getItem('navaid.inspectorWhileTracking') };
  });
  expect(got.before, 'it ships off').toBe(false);
  expect(got.shutWithout).toBe(true);
  expect(got.open).toBe(true);
  expect(got.stored).toBe('1');
});

test('the choice outranks the gist, in both directions', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    startLiveLocation();
    window.__geoCb({ coords: { latitude: 32, longitude: 34, accuracy: 8 }, timestamp: Date.now() });
    await new Promise(r => setTimeout(r, 20));
    const out = {};
    // Gist on, pilot off: the pilot wins.
    NavAid.tuningDefaults.featureInspectorWhileTracking.value = true;
    localStorage.setItem('navaid.inspectorWhileTracking', '0');
    out.pilotOff = inspectorWhileTrackingOn();
    // Gist off, pilot on: still the pilot.
    NavAid.tuningDefaults.featureInspectorWhileTracking.value = false;
    localStorage.setItem('navaid.inspectorWhileTracking', '1');
    out.pilotOn = inspectorWhileTrackingOn();
    // Untouched: the gist answers, so a config push still reaches a device that never opened
    // the menu.
    localStorage.removeItem('navaid.inspectorWhileTracking');
    NavAid.tuningDefaults.featureInspectorWhileTracking.value = true;
    out.gist = inspectorWhileTrackingOn();
    return out;
  });
  expect(got).toEqual({ pilotOff: false, pilotOn: true, gist: true });
});

// Reported: with the map locked for selecting a waypoint, the multiple-waypoint chooser still
// opens -- where several points overlap, or on a frequency-change arrow. The panel obeyed the
// rule; the question that comes BEFORE the panel did not, so in flight a tap still put a
// modal over the chart asking which point to open.
test('the point chooser obeys the same rule as the panel', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    const seen = [];
    window.showToast = (m) => seen.push(String(m));
    startLiveLocation();
    window.__geoCb({ coords: { latitude: 32, longitude: 34, accuracy: 8 }, timestamp: Date.now() });
    await new Promise(r => setTimeout(r, 20));
    // Two things under one finger: the chooser's whole reason to exist.
    const opened = showPointChoice([{ type: 'wp', index: 0 }, { type: 'wp', index: 1 }]);
    return { opened, modals: document.querySelectorAll('.point-choice-modal').length,
             panel: document.getElementById('inspector').classList.contains('hidden'),
             selected: state.selected, said: seen[0] || '' };
  });
  expect(got.opened).toBe(false);
  expect(got.modals, 'the chooser opened over the chart').toBe(0);
  expect(got.panel).toBe(true);
  expect(got.selected).toBe(null);
  // ...and it says why, in the same words the panel uses.
  expect(got.said).toMatch(/View\/Set/i);
});

test('on the ground the chooser is untouched', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    const opened = showPointChoice([{ type: 'wp', index: 0 }, { type: 'wp', index: 1 }]);
    return { opened, modals: document.querySelectorAll('.point-choice-modal').length };
  });
  expect(got.opened).toBe(true);
  expect(got.modals).toBe(1);
});
