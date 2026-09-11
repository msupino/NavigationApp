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

// A recording has no plan in it -- no legs, no planned altitude, no planned speed -- but it
// has what was actually flown: the height the receiver reported, and the speed between one
// fix and the next. That is the more useful of the two pictures, and it was the one missing.
test('a recording is profiled by what it actually flew', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    // Six fixes: climbing, and roughly 100 kt between them.
    const t0 = Date.parse('2026-09-11T06:00:00Z');
    const track = [];
    for (let i = 0; i < 6; i++) {
      track.push({ lat: 32.0 + i * 0.03, lng: 34.9, t: t0 + i * 60000, alt: 300 + i * 120 });
    }
    const all = loadRouteLibrary();
    all.unshift({ id: 'trk-prof', name: 'morning hop', kind: 'gps',
      savedAt: new Date().toISOString(), track: track });
    persistRouteLibrary(all);
  });
  await openLibrary(page);
  await page.locator('.route-library-profile').first().click();
  await expect(page.locator('.route-profile-canvas').first()).toBeVisible();
  const totals = await page.locator('.route-profile-totals').first().textContent();
  expect(totals).toMatch(/NM/);
  expect(totals).toMatch(/min|:/);
  // Feet, from metres: the receiver reports altitude in metres and the strip is in feet.
  expect(totals).toMatch(/max 2[0-9]{3} ft/);
  expect(totals).toContain('flown');
});

test('ground speed is derived between fixes and smoothed', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    const t0 = Date.parse('2026-09-11T06:00:00Z');
    // A minute apart, 0.03 degrees of latitude each: ~1.8 NM per minute, ~108 kt.
    const pts = [];
    for (let i = 0; i < 8; i++) pts.push({ lat: 32 + i * 0.03, lng: 34.9, t: t0 + i * 60000, alt: 500 });
    const s = trackProfileSamples(pts, 1);
    // One fix knocked sideways: a receiver glitch, not an aeroplane that accelerated.
    const noisy = pts.map((p, i) => (i === 4 ? { lat: p.lat + 0.02, lng: p.lng, t: p.t, alt: p.alt } : p));
    const rough = trackProfileSamples(noisy, 1);
    const smooth = trackProfileSamples(noisy, 5);
    const spike = (arr) => Math.max.apply(null, arr.map(p => p.kt || 0));
    return { firstKt: s[0].kt, steady: s[3].kt, dist: s[s.length - 1].d,
             roughSpike: spike(rough), smoothSpike: spike(smooth), steadyKt: spike(s) };
  });
  // The first fix has nothing to be measured against, so it claims no speed.
  expect(got.firstKt).toBeNull();
  expect(got.steady).toBeGreaterThan(90);
  expect(got.steady).toBeLessThan(130);
  expect(got.dist).toBeGreaterThan(10);
  // Smoothing does not remove the glitch, it stops it reading as a real acceleration.
  expect(got.roughSpike).toBeGreaterThan(got.smoothSpike);
});

test('a recording with no altitude says so rather than drawing a flat lie', async ({ page }) => {
  await boot(page);
  const drawn = await page.evaluate(() => {
    const t0 = Date.parse('2026-09-11T06:00:00Z');
    const pts = [];
    for (let i = 0; i < 5; i++) pts.push({ lat: 32 + i * 0.02, lng: 34.9, t: t0 + i * 60000, alt: null });
    const texts = [];
    const c = document.createElement('canvas');
    c.width = 400; c.height = 150;
    const ctx = c.getContext('2d');
    const realFill = ctx.fillText.bind(ctx);
    ctx.fillText = (t, x, y) => { texts.push(String(t)); realFill(t, x, y); };
    const ok = drawTrackProfile(ctx, 0, 0, 400, 150, pts);
    return { ok, texts };
  });
  expect(drawn.ok).toBe(true);
  expect(drawn.texts.join(' ')).toContain('No altitude recorded');
  // The speed trace still has something to say, so its axis is still labelled.
  expect(drawn.texts).toContain('kt');
});

test('the panel closes again, and both kinds of entry offer one', async ({ page }) => {
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
  // Both kinds are profiled now -- a plan by what it intends, a recording by what it did.
  await expect(btn).toHaveCount(2);
  await btn.first().click();
  await expect(page.locator('.route-profile-panel').first()).toBeVisible();
  await btn.first().click();
  await expect(page.locator('.route-profile-panel').first()).toBeHidden();
});

// A profile worth reading is a profile worth keeping: to a kneeboard, to a student, to the
// club's group. The picture goes out through saveFile(), which is the browser's download in
// a browser and the system share sheet on the phone -- the one place that knows how a file
// leaves this app.
test('the profile can be saved as an image', async ({ page }) => {
  await boot(page);
  await saveRoute(page, 'Herzliya to Haifa');
  await openLibrary(page);
  // Catch what would be handed to the platform, without going near it.
  await page.evaluate(() => {
    window.__saved = [];
    window.saveFile = (blob, name) => { window.__saved.push({ name, type: blob.type, size: blob.size }); return Promise.resolve(true); };
  });
  await page.locator('.route-library-profile').first().click();
  await page.locator('.route-profile-export').first().click();
  await page.waitForFunction(() => window.__saved.length > 0);
  const [file] = await page.evaluate(() => window.__saved);
  expect(file.type).toBe('image/png');
  expect(file.size).toBeGreaterThan(1000);          // a real image, not an empty canvas
  // Named for the route it is a picture of, and stamped, so two exports do not collide.
  expect(file.name).toMatch(/^Herzliya-to-Haifa-profile-\d{8}-\d{6}\.png$/);
});

test('a recording exports too, and the picture carries its own caption', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const t0 = Date.parse('2026-09-11T06:00:00Z');
    const track = [];
    for (let i = 0; i < 10; i++) track.push({ lat: 32 + i * 0.02, lng: 34.9, t: t0 + i * 60000, alt: 400 + i * 60 });
    const all = loadRouteLibrary();
    all.unshift({ id: 'trk-x', name: 'nav ex', kind: 'gps', savedAt: new Date().toISOString(), track });
    persistRouteLibrary(all);
  });
  await openLibrary(page);
  const drawn = await page.evaluate(() => {
    // Record what the exported image is told to write, which is where the name and the
    // figures end up -- they are not in the strip itself.
    const texts = [];
    const realGet = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, o) {
      const ctx = realGet.call(this, kind, o);
      if (ctx && kind === '2d' && !ctx.__spied) {
        ctx.__spied = true;
        const realFill = ctx.fillText.bind(ctx);
        ctx.fillText = (t, x, y, m) => { texts.push(String(t)); return realFill(t, x, y, m); };
      }
      return ctx;
    };
    window.__texts = texts;
    window.saveFile = () => Promise.resolve(true);
    return true;
  });
  expect(drawn).toBe(true);
  await page.locator('.route-library-profile').first().click();
  await page.locator('.route-profile-export').first().click();
  await page.waitForTimeout(300);
  const texts = await page.evaluate(() => window.__texts);
  expect(texts).toContain('nav ex');                       // the name is on the picture
  expect(texts.some(t => /NM/.test(t) && /flown/.test(t))).toBe(true);   // and the figures
});
