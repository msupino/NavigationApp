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
