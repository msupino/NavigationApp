// @ts-check
// A saved route could only be inspected by loading it -- which replaces the route on the
// map. So "was that the one I planned at 3500?" cost the pilot their working route, or a
// save first. The library now draws each entry's profile in place: altitude and planned
// speed against distance, from the saved data alone.
//
// Planned speed, not ground speed: it is the only speed a saved route carries, it needs no
// wind fetch, and a route saved months ago has no wind to correct by.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof routeProfile === 'function'
    && typeof showRouteLibraryModal === 'function' && typeof routeLibrarySaveCurrent === 'function');
}

// Two legs at different altitudes and different speeds, so both traces have something to say.
async function saveRoute(page, name) {
  return page.evaluate((nm) => {
    state.waypoints = [
      { lat: 32.0, lng: 34.9, name: 'A' },
      { lat: 32.3, lng: 35.1, name: 'B' },
      { lat: 32.6, lng: 35.0, name: 'C' },
    ];
    syncLegs();
    state.legs[0].inboundAltitude = 2500;
    state.legs[0].flightSpeed = 100;
    state.legs[1].inboundAltitude = 4500;
    state.legs[1].flightSpeed = 130;
    const entry = routeLibrarySaveCurrent(nm);
    return entry && entry.id;
  }, name);
}

const openLibrary = async (page) => {
  await page.evaluate(() => showRouteLibraryModal());
  await page.waitForSelector('.route-library-row');
};

test('a saved route can be profiled without being loaded', async ({ page }) => {
  await boot(page);
  await saveRoute(page, 'planned high');
  // Work on something else entirely, the way a pilot would.
  await page.evaluate(() => {
    state.waypoints = [{ lat: 31.8, lng: 34.7, name: 'X' }, { lat: 31.9, lng: 34.8, name: 'Y' }];
    syncLegs();
    state.legs[0].inboundAltitude = 1000;
  });
  await openLibrary(page);
  await page.locator('.route-library-profile').first().click();
  await expect(page.locator('.route-profile-panel').first()).toBeVisible();
  await expect(page.locator('.route-profile-canvas').first()).toBeVisible();
  // The working route is untouched: that is the whole point of not loading it.
  const live = await page.evaluate(() => ({
    wps: state.waypoints.map(w => w.name), alt: state.legs[0].inboundAltitude,
  }));
  expect(live.wps).toEqual(['X', 'Y']);
  expect(live.alt).toBe(1000);
});

test('the totals are the saved route\'s, not the one on the map', async ({ page }) => {
  await boot(page);
  await saveRoute(page, 'saved one');
  const savedTotals = await page.evaluate(() => {
    const p = routeProfile(undefined, null, { waypoints: state.waypoints, legs: state.legs });
    return { nm: p.totalDist.toFixed(1), hours: p.totalTimeH };
  });
  await page.evaluate(() => { state.waypoints = []; syncLegs(); });
  await openLibrary(page);
  await page.locator('.route-library-profile').first().click();
  const shown = await page.locator('.route-profile-totals').first().textContent();
  expect(shown).toContain(savedTotals.nm + ' NM');
  expect(savedTotals.hours).toBeGreaterThan(0);
});

test('routeProfile reads the route it is handed, and the live one when handed none', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.2, lng: 35.0, name: 'B' }];
    syncLegs();
    state.legs[0].inboundAltitude = 1500;
    const other = {
      waypoints: [{ lat: 31.0, lng: 34.5, name: 'P' }, { lat: 31.9, lng: 35.4, name: 'Q' }],
      legs: [Object.assign({}, state.legs[0], { inboundAltitude: 7500, flightSpeed: 150 })],
    };
    return {
      liveAlt: Math.max.apply(null, routeProfile().pts.map(p => p.alt)),
      otherAlt: Math.max.apply(null, routeProfile(undefined, null, other).pts.map(p => p.alt)),
      liveDist: routeProfile().totalDist,
      otherDist: routeProfile(undefined, null, other).totalDist,
      // ...and asking for the other route must not have disturbed the live one.
      stillLive: routeProfile().pts.map(p => p.alt),
    };
  });
  expect(got.liveAlt).toBe(1500);
  expect(got.otherAlt).toBe(7500);
  expect(got.otherDist).toBeGreaterThan(got.liveDist);
  expect(Math.max.apply(null, got.stillLive)).toBe(1500);
});

test('the speed trace is a step, drawn only where a speed was planned', async ({ page }) => {
  await boot(page);
  const strokes = await page.evaluate(() => {
    const route = {
      waypoints: [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.3, lng: 35.1, name: 'B' },
        { lat: 32.6, lng: 35.0, name: 'C' }],
      legs: [],
    };
    state.waypoints = route.waypoints.slice();
    syncLegs();
    route.legs = [Object.assign({}, state.legs[0], { inboundAltitude: 2500, flightSpeed: 100 }),
      Object.assign({}, state.legs[1], { inboundAltitude: 4500, flightSpeed: 0 })];
    // A recording context: every line the profile draws, and the colour it used.
    const seen = [];
    const c = document.createElement('canvas');
    c.width = 400; c.height = 150;
    const ctx = c.getContext('2d');
    const realStroke = ctx.stroke.bind(ctx);
    const realMove = ctx.moveTo.bind(ctx);
    const realLine = ctx.lineTo.bind(ctx);
    let path = [];
    ctx.moveTo = (x, y) => { path = [[x, y]]; realMove(x, y); };
    ctx.lineTo = (x, y) => { path.push([x, y]); realLine(x, y); };
    ctx.stroke = () => { seen.push({ color: ctx.strokeStyle, path: path.slice(), dash: ctx.getLineDash().join() }); realStroke(); };
    drawVerticalProfile(ctx, 0, 0, 400, 150, { route: route, speed: true });
    return { seen, speedColor: NavAid.tuningDefaults.profileSpeedColor.value };
  });
  const speedLines = strokes.seen.filter(s => String(s.color).toLowerCase() === strokes.speedColor.toLowerCase());
  expect(speedLines.length).toBeGreaterThan(0);
  // A leg is flown at one speed: every speed segment is flat, or a vertical riser between
  // two legs. A sloped line would draw an acceleration nobody planned.
  for (const line of speedLines) {
    const [a, b] = [line.path[0], line.path[line.path.length - 1]];
    const flat = Math.abs(a[1] - b[1]) < 0.01;
    const riser = Math.abs(a[0] - b[0]) < 0.01;
    expect(flat || riser, 'speed segment is neither level nor a riser').toBe(true);
  }
  // The second leg had no speed, so exactly one leg's worth of trace is drawn -- no riser
  // to a speed that was never planned.
  expect(speedLines.length).toBe(1);
});

test('an entry with nothing to draw says so instead of an empty box', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const all = loadRouteLibrary();
    all.unshift({ id: 'stub-1', name: 'one point only', savedAt: new Date().toISOString(),
      data: { waypoints: [{ lat: 32, lng: 34.9, name: 'A' }], legs: [], notes: [] } });
    persistRouteLibrary(all);
  });
  await openLibrary(page);
  await page.locator('.route-library-profile').first().click();
  await expect(page.locator('.route-profile-empty').first()).toBeVisible();
});

test('the panel closes again, and a GPS recording is not offered one', async ({ page }) => {
  await boot(page);
  await saveRoute(page, 'closes again');
  await page.evaluate(() => {
    const all = loadRouteLibrary();
    all.push({ id: 'trk-1', name: 'a recording', kind: 'gps', savedAt: new Date().toISOString(),
      track: [{ lat: 32, lng: 34.9, t: 0, alt: 100 }, { lat: 32.1, lng: 35, t: 60, alt: 200 }] });
    persistRouteLibrary(all);
  });
  await openLibrary(page);
  const btn = page.locator('.route-library-profile');
  // A track is a recording, not a plan: it has no legs, no planned altitude and no planned
  // speed, so there is no profile of it to draw.
  await expect(btn).toHaveCount(1);
  await btn.first().click();
  await expect(page.locator('.route-profile-panel').first()).toBeVisible();
  await btn.first().click();
  await expect(page.locator('.route-profile-panel').first()).toBeHidden();
});
