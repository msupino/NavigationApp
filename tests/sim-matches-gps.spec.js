// @ts-check
// A simulator feed and a real fix are the same thing from the map's point of view: something
// is flying the route. Everything that exists BECAUSE the aircraft is moving — the in-flight
// control column, the ATIS marker, the layout lock — must therefore behave the same in both,
// or a flight tested in the sim does not show what the flight will show. (Reported: none of it
// appeared in sim mode.)
//
// One thing stays deliberately different, and is asserted here so it cannot drift by accident:
// the inspector. A sim session is someone at a desk, where opening a waypoint is the point; in
// the air a stray tap covering the map with the inspector is the thing to avoid.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 41; };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof gpsPositionLive === 'function' &&
    typeof startLiveLocation === 'function' && Array.isArray(airfields) && airfields.length > 0);
  await page.evaluate(() => {
    const af = airfields.find(a => a.name === 'LLHA');
    state.waypoints = [{ lat: af.lat - 0.5, lng: af.lng - 0.2, name: 'START' },
                       { lat: af.lat, lng: af.lng, name: 'LLHA' }];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 100; });
    draw();
  });
}

// What the map shows for a given source of position.
const survey = (page) => page.evaluate(() => {
  draw();
  const shown = (id) => {
    const el = document.getElementById(id);
    return !!el && getComputedStyle(el.parentNode).display !== 'none';
  };
  return {
    positionLive: gpsPositionLive(),
    mapLocked: gpsMapLocked(),
    voiceBtn: shown('voice-toggle'),
    orientBtn: shown('orient-toggle'),
    followBtn: shown('follow-lock'),
    atisMarker: !!window.__atisMarker,
    dragLocked: typeof dragLockedNow === 'function' ? dragLockedNow('wp') : null,
  };
});

test('the simulator shows the same in-flight furniture as a real fix', async ({ page }) => {
  await boot(page);
  const idle = await survey(page);
  expect(idle.positionLive).toBe(false);
  expect(idle.voiceBtn).toBe(false);
  expect(idle.atisMarker).toBe(false);

  await page.evaluate(() => startLiveLocation());
  const live = await survey(page);
  await page.evaluate(() => stopLiveLocation());

  await page.evaluate(() => { window.simOn = true; if (typeof refreshVoiceControl === 'function') refreshVoiceControl(); if (typeof refreshOrientControl === 'function') refreshOrientControl(); if (typeof refreshGpsFollowControl === 'function') refreshGpsFollowControl(); });
  const sim = await survey(page);
  await page.evaluate(() => { window.simOn = false; });

  // Field by field, so a difference names itself rather than failing as one blob.
  for (const k of ['positionLive', 'mapLocked', 'voiceBtn', 'orientBtn', 'followBtn', 'atisMarker', 'dragLocked']) {
    expect(sim[k], k).toBe(live[k]);
  }
  expect(sim.voiceBtn).toBe(true);
  expect(sim.atisMarker).toBe(true);
});

test('the route layout is locked in both', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const kinds = ['wp', 'note', 'label', 'cumlabel', 'cumlabelret'];
    window.simOn = true;
    const sim = kinds.map(k => dragLockedNow(k));
    window.simOn = false;
    startLiveLocation();
    const live = kinds.map(k => dragLockedNow(k));
    stopLiveLocation();
    return { sim, live };
  });
  expect(out.sim).toEqual(out.live);
  expect(out.sim.every(Boolean)).toBe(true);
});

test('the inspector rule is the one deliberate difference', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    window.simOn = true;
    const sim = inspectorAllowedNow();
    window.simOn = false;
    startLiveLocation();
    const live = inspectorAllowedNow();
    stopLiveLocation();
    return { sim, live };
  });
  expect(out.sim).toBe(true);     // at a desk, opening a waypoint is the point
  expect(out.live).toBe(false);   // in the air it covers the map you are flying by
});

// Reported: "buttons keep switching location" and "lock map button is missing". Each control
// used to insert itself as the corner's firstChild on every refresh, so whichever refreshed
// last owned the top and the column reshuffled as state changed — and a button could end up
// below the fold. One rank list, applied by one function, whoever refreshes.
test('the in-flight column keeps a fixed order however often it refreshes', async ({ page }) => {
  await boot(page);
  const order = () => page.evaluate(() => {
    const corner = document.querySelector('.leaflet-bottom.leaflet-right');
    return Array.prototype.map.call(corner.children, el => el.className)
      .filter(c => /voice-ctrl|orient-ctrl|follow-ctrl|rotate-ctrl/.test(c))
      .map(c => c.replace('leaflet-control ', ''));
  });
  await page.evaluate(() => startLiveLocation());
  const first = await order();
  expect(first).toEqual(['voice-ctrl', 'orient-ctrl', 'follow-ctrl', 'rotate-ctrl']);

  // Refresh them in the awkward order — the one that used to leave the last caller on top.
  await page.evaluate(() => {
    refreshGpsFollowControl(); refreshOrientControl(); refreshVoiceControl();
    refreshVoiceControl(); refreshGpsFollowControl();
  });
  expect(await order()).toEqual(first);
});

test('connecting the simulator brings the column up; disconnecting takes it away', async ({ page }) => {
  await boot(page);
  const shown = () => page.evaluate(() => ['voice-toggle', 'orient-toggle', 'follow-lock']
    .map(id => getComputedStyle(document.getElementById(id).parentNode).display !== 'none'));
  expect(await shown()).toEqual([false, false, false]);
  // simStart()/simStop() without a bridge to poll: the state change is what is under test.
  await page.evaluate(() => { window.simOn = true; simRefreshFlightControls(); });
  expect(await shown()).toEqual([true, true, true]);
  await page.evaluate(() => { window.simOn = false; simRefreshFlightControls(); });
  expect(await shown()).toEqual([false, false, false]);
});

// Reported: the orientation and follow-lock buttons did nothing in sim. The sim poll called
// map.setView() directly, which goes round the follow lock, its pan grace and the heading-up
// rotation — all of which live in the helpers the real-fix path uses.
test('the follow lock and heading-up work off a simulator feed', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    window.simOn = true; window.simFollow = true;
    window.simAircraft = { lat: 32.60, lng: 35.00, hdg: 90, alt: 2000, gs: 100 };
    // What the sim poll now does with a fresh sample.
    const feed = () => {
      gpsOwn = { lat: simAircraft.lat, lng: simAircraft.lng, hdg: simAircraft.hdg, t: Date.now() };
      if (simFollow && gpsFollow && !gpsFollowSuspended()) gpsFollowRecenter(simAircraft.lat, simAircraft.lng);
      gpsApplyHeadingUp();
    };

    map.setView([32.0, 34.5], 10);
    window.gpsFollow = true; window.headingUpOn = false;
    feed();
    const followed = { lat: +map.getCenter().lat.toFixed(3), bearing: Math.round(mapBearing()) };

    // Lock off: the map must stay where the pilot put it.
    window.gpsFollow = false;
    map.setView([32.0, 34.5], 10);
    simAircraft.lat = 32.75;
    feed();
    const locked = +map.getCenter().lat.toFixed(3);

    // Heading up: the chart turns to put the track at the top (bearing = 360 - heading).
    // Through the button, not by assigning window.headingUpOn -- that is a module binding, and
    // a window property of the same name is a different variable applyHeadingUp never reads.
    window.gpsFollow = true;
    document.getElementById('orient-toggle').click();
    simAircraft.hdg = 90;
    feed();
    const rotated = Math.round(mapBearing());
    document.getElementById('orient-toggle').click();     // back to north-up
    map.setBearing(0);
    window.simOn = false;
    return { followed, locked, rotated };
  });
  expect(out.followed.lat).toBeCloseTo(32.60, 1);   // the map moved to the aircraft
  expect(out.locked).toBeCloseTo(32.0, 1);          // ...and did not, with the lock off
  expect(out.rotated).toBe(270);                    // heading 090 -> map bearing 270
});

// Two switches for one behaviour is how the lock ended up doing nothing: the panel had its own
// flag and recentred past the button. Turning the panel's Follow on releases the lock too.
test('the sim panel Follow and the map lock cannot disagree', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    window.gpsFollow = false; window.simFollow = false;
    document.getElementById('sim-follow-cb').onclick();
    return { simFollow: window.simFollow, gpsFollow: window.gpsFollow,
             stored: localStorage.getItem('navaid.gpsFollow') };
  });
  expect(out.simFollow).toBe(true);
  expect(out.gpsFollow).toBe(true);
  expect(out.stored).toBe('1');
});
