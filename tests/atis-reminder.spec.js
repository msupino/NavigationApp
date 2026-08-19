// @ts-check
// A reminder to pull the destination's ATIS, far enough out to tune, hear a full cycle and
// copy the numbers before the arrival gets busy — so it is timed, not measured in miles, and
// it uses the planned speed like every other in-flight alert. It fires once per arrival, and
// the map shows where it will happen so the question can be answered on the ground.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 31; };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof gpsDestinationAtis === 'function' &&
    typeof airfieldAtWaypoint === 'function' && Array.isArray(airfields) && airfields.length > 0);
}

// A route ending at a field that publishes ATIS.
const routeTo = (page, icao) => page.evaluate((code) => {
  const af = airfields.find(a => a.name === code);
  const start = { lat: af.lat - 0.55, lng: af.lng - 0.25, name: 'START' };
  state.waypoints = [start, { lat: af.lat, lng: af.lng, name: code }];
  state.legs = []; syncLegs();
  state.legs.forEach(l => { l.flightSpeed = 100; });
  draw();
  return { atis: gpsDestinationAtis(), legNm: geo(state.waypoints[0], state.waypoints[1]).dist };
}, icao);

const alerts = [];
async function captureAlerts(page) {
  await page.evaluate(() => {
    window.__alerts = [];
    const real = window.gpsSendWatchAlert;
    window.gpsSendWatchAlert = (title, body, speech) => { window.__alerts.push({ title, body, speech }); return real(title, body, speech); };
  });
}

test('a field that publishes ATIS is found; one that does not is not invented', async ({ page }) => {
  await boot(page);
  const withAtis = await routeTo(page, 'LLBG');
  expect(withAtis.atis).not.toBeNull();
  expect(withAtis.atis.freq).toContain('132');
  const without = await page.evaluate(() => {
    const af = airfields.find(a => !a.atis);
    state.waypoints = [{ lat: af.lat - 0.4, lng: af.lng, name: 'START' },
                       { lat: af.lat, lng: af.lng, name: af.name }];
    state.legs = []; syncLegs();
    return { icao: af.name, atis: gpsDestinationAtis() };
  });
  expect(without.atis).toBeNull();       // silence beats a made-up frequency
});

test('the reminder fires inside the lead time, once, and names the frequency', async ({ page }) => {
  await boot(page);
  await routeTo(page, 'LLBG');
  await captureAlerts(page);
  const out = await page.evaluate(() => {
    setTune('atisLeadSec', 600);                    // 10 min at 100 kt = 16.7 NM
    // Sit 10 NM out on the inbound track: 6 minutes at 100 kt, inside the lead.
    const dest = state.waypoints[1], start = state.waypoints[0];
    const f = 1 - (10 / geo(start, dest).dist);
    gpsOwn = { lat: start.lat + (dest.lat - start.lat) * f,
               lng: start.lng + (dest.lng - start.lng) * f, hdg: 0, t: Date.now() };
    gpsAlertLegIndex = 0; _gpsAlertConfirmed = true; _gpsAtisAlerted = false;
    gpsCheckLegAlerts();
    const first = window.__alerts.filter(a => a.title === 'ATIS').length;
    gpsCheckLegAlerts();                            // still inbound: must not repeat
    const after = window.__alerts.filter(a => a.title === 'ATIS');
    return { first, count: after.length, body: after[0] && after[0].body, speech: after[0] && after[0].speech };
  });
  expect(out.first).toBe(1);
  expect(out.count).toBe(1);                        // once per arrival
  expect(out.body).toContain('132');
  expect(out.speech).toMatch(/A T I S/);            // spoken as letters, not "atis"
});

test('it stays quiet while the destination is still far out', async ({ page }) => {
  await boot(page);
  await routeTo(page, 'LLBG');
  await captureAlerts(page);
  const count = await page.evaluate(() => {
    setTune('atisLeadSec', 300);                    // 5 min at 100 kt = 8.3 NM
    const dest = state.waypoints[1], start = state.waypoints[0];
    gpsOwn = { lat: start.lat, lng: start.lng, hdg: 0, t: Date.now() };   // ~33 NM out
    gpsAlertLegIndex = 0; _gpsAlertConfirmed = true; _gpsAtisAlerted = false;
    gpsCheckLegAlerts();
    void dest;
    return window.__alerts.filter(a => a.title === 'ATIS').length;
  });
  expect(count).toBe(0);
});

test('the marker sits where the reminder will fire, and only while tracking', async ({ page }) => {
  await boot(page);
  const r = await routeTo(page, 'LLBG');
  const out = await page.evaluate((legNm) => {
    setTune('atisLeadSec', 600);                    // 10 min at 100 kt = 16.67 NM to run
    const idle = atisAlertPoint();                  // not recording: nothing promised
    gpsLiveOn = true;
    const live = atisAlertPoint();
    const dest = state.waypoints[1];
    const fromDest = live ? geo(live, dest).dist : null;
    gpsLiveOn = false;
    return { idle, fromDest, legNm };
  }, r.legNm);
  expect(out.idle).toBeNull();
  expect(out.fromDest).toBeCloseTo(16.67, 0);       // lead time × planned speed
});

test('a longer lead moves the marker back up the route', async ({ page }) => {
  await boot(page);
  await routeTo(page, 'LLBG');
  const out = await page.evaluate(() => {
    gpsLiveOn = true;
    setTune('atisLeadSec', 300);
    const near = geo(atisAlertPoint(), state.waypoints[1]).dist;
    setTune('atisLeadSec', 900);
    const far = geo(atisAlertPoint(), state.waypoints[1]).dist;
    gpsLiveOn = false;
    return { near, far };
  });
  expect(out.far).toBeGreaterThan(out.near);
});

test('no ATIS at the destination means no marker at all', async ({ page }) => {
  await boot(page);
  const drawn = await page.evaluate(() => {
    const af = airfields.find(a => !a.atis);
    state.waypoints = [{ lat: af.lat - 0.4, lng: af.lng, name: 'START' },
                       { lat: af.lat, lng: af.lng, name: af.name }];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 100; });
    gpsLiveOn = true;
    const p = atisAlertPoint();
    gpsLiveOn = false;
    return p;
  });
  expect(drawn).toBeNull();
});
