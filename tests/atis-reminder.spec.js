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

// Alerts are collected in the PAGE (window.__alerts), not here: gpsSendWatchAlert runs in the
// browser, so a Node-side array would only ever stay empty.
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
  // Short: the field and the frequency, nothing else. A notification is read at a glance, and
  // the lead time is why it fired rather than something to read back off the screen.
  expect(out.body).not.toMatch(/\bmin\b/);
  expect(out.body.length).toBeLessThan(30);
});

test('it stays quiet while the destination is still far out', async ({ page }) => {
  await boot(page);
  await routeTo(page, 'LLBG');
  await captureAlerts(page);
  const count = await page.evaluate(() => {
    setTune('atisLeadSec', 300);                    // 5 min at 100 kt = 8.3 NM
    const start = state.waypoints[0];
    gpsOwn = { lat: start.lat, lng: start.lng, hdg: 0, t: Date.now() };   // ~33 NM out
    gpsAlertLegIndex = 0; _gpsAlertConfirmed = true; _gpsAtisAlerted = false;
    gpsCheckLegAlerts();
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

// Reported: the marker appeared and then vanished. Clearing one leg's speed removed it
// entirely — every leg had to have a speed or atisAlertPoint() gave up, so an ordinary edit
// deleted the marker with no explanation. A leg without a speed now falls back to the route
// default, which is off by the difference between two cruise speeds rather than absent.
test('a leg with no speed falls back to the default instead of deleting the marker', async ({ page }) => {
  await boot(page);
  await routeTo(page, 'LLBG');
  const out = await page.evaluate(() => {
    gpsLiveOn = true;
    const before = atisAlertPoint();
    state.legs.forEach(l => { l.flightSpeed = NaN; });      // as clearing the field does
    const after = atisAlertPoint();
    gpsLiveOn = false;
    return { before: !!before, after: !!after, dflt: tune('defaultLegSpeedKt') };
  });
  expect(out.before).toBe(true);
  expect(out.after).toBe(true);          // still shown, using the route default
  expect(out.dflt).toBeGreaterThan(0);
});

// A bare "ATIS" made you open the airfield to find out what you would be tuning.
test('the marker carries the frequency, shortened from the published wording', async ({ page }) => {
  await boot(page);
  const short = await page.evaluate(() => ({
    pair: atisShortFreq('Arrival 132.50 MHz / Departure 132.80 MHz'),
    plain: atisShortFreq('132.55 MHz'),
    none: atisShortFreq(''),
  }));
  expect(short.pair).toBe('132.50');     // the one an arriving pilot tunes
  expect(short.plain).toBe('132.55');
  expect(short.none).toBe('');
});

test('the marker is drawn big enough to read', async ({ page }) => {
  await boot(page);
  const sizes = await page.evaluate(() => ({
    radius: tune('atisMarkerRadiusPx'), font: tune('atisMarkerFontPx'),
  }));
  expect(sizes.radius).toBeGreaterThanOrEqual(10);
  expect(sizes.font).toBeGreaterThanOrEqual(12);
});

// The Hebrew body used to end with "<n> דקות לפני" after a Latin run, and a notification laid
// out left-to-right stranded the number at the wrong end: "דקות לפני 7". What is left is one
// Hebrew word and a single Latin run, which orders correctly whichever way the client lays it.
test('the Hebrew alert reads correctly and stays short', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof S === 'object' && S && typeof S.watchAlertAtisBody === 'function');
  const body = await page.evaluate(() => S.watchAlertAtisBody('LLBG', '132.50'));
  expect(body).toBe('ATIS LLBG 132.50');
  expect(body).not.toMatch(/דקות/);
  expect(body.length).toBeLessThan(30);
});

// Reported: still not visible. It was drawn BEFORE the route and the waypoint discs, so the
// line ran through it — and on a route shorter than the lead time it landed exactly under the
// departure waypoint, completely hidden.
test('the marker is drawn after the route, not under it', async ({ page }) => {
  await boot(page);
  await routeTo(page, 'LLBG');
  const order = await page.evaluate(() => {
    gpsLiveOn = true;
    const seq = [];
    const realWp = window.drawWaypoints, realAtis = window.drawAtisMarker;
    window.drawWaypoints = (...a) => { seq.push('waypoints'); return realWp.apply(null, a); };
    window.drawAtisMarker = (...a) => { seq.push('atis'); return realAtis.apply(null, a); };
    draw();
    window.drawWaypoints = realWp; window.drawAtisMarker = realAtis;
    gpsLiveOn = false;
    return seq;
  });
  expect(order.indexOf('atis')).toBeGreaterThan(order.indexOf('waypoints'));
});

test('on a route shorter than the lead, the marker clears the departure waypoint', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const af = airfields.find(a => a.name === 'LLBG');
    // ~8 NM: at 100 kt that is under 5 minutes, so a 10-minute lead is due before departure.
    state.waypoints = [{ lat: af.lat - 0.13, lng: af.lng, name: 'START' },
                       { lat: af.lat, lng: af.lng, name: 'LLBG' }];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 100; });
    gpsLiveOn = true;
    const p = atisAlertPoint();
    // Where it actually paints, after the offset that keeps it out of the disc.
    let painted = null;
    const realArc = octx.arc.bind(octx);
    octx.arc = (x, y, rr, ...rest) => { if (painted === null && rr === tune('atisMarkerRadiusPx')) painted = { x, y }; return realArc(x, y, rr, ...rest); };
    drawAtisMarker();
    octx.arc = realArc;
    const wp = proj(state.waypoints[0]);
    gpsLiveOn = false;
    return { atStart: !!(p && p.atStart), gap: painted ? Math.hypot(painted.x - wp.x, painted.y - wp.y) : 0,
             disc: waypointDiscRadiusPx() };
  });
  expect(out.atStart).toBe(true);
  expect(out.gap).toBeGreaterThan(out.disc);     // outside the waypoint's own circle
});

// Codes are spelled, not pronounced: "LLHA" read as a word is something a pilot has to decode,
// and the whole point of speaking an alert is that it lands without decoding.
test('the field is spelled out letter by letter', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => ({
    icao: gpsSpokenCode('LLHA', 'en'),
    reg: gpsSpokenCode('4X-ABC', 'en'),
    empty: gpsSpokenCode('', 'en'),
  }));
  expect(out.icao).toBe('L L H A');
  expect(out.reg).toBe('four X A B C');       // digits keep their words, the hyphen is dropped
  expect(out.empty).toBe('');
});
