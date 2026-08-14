// #672 — top-of-climb / top-of-descent + vertical profile.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof routeProfile === 'function' && typeof showFlightPlan === 'function');
}

// 3 legs at 3000 / 6000 / 6000 ft. Each leg keeps its own altitude. Field elevations
// are stubbed low at both ends; only the leg that STARTS on a field climbs, so there
// is one TOC and — since no descent is invented onto the destination — no TOD.
async function seed(page) {
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.2, lng: 34.9, name: 'B' },
      { lat: 32.6, lng: 35.1, name: 'C' }, { lat: 32.8, lng: 35.2, name: 'D' },
    ];
    state.legs = []; syncLegs();
    const a = [3000, 6000, 6000];
    state.legs.forEach((l, i) => { l.flightSpeed = 110; l.inboundAltitude = a[i]; });
    // Stub field elevations: low departure/destination so climb/descent occur.
    routeEndpointElev = i => (i === 0 ? 500 : i === state.legs.length ? 800 : null);
  });
}

test('routeProfile: per-leg altitudes, one TOC off the field, no TOD', async ({ page }) => {
  await boot(page);
  await seed(page);
  const p = await page.evaluate(() => routeProfile({ gph: 8, climbFpm: 700, climbKt: 75 }));
  const last = p.legs.length - 1;
  // The climb off the departure field is the only ramp, so exactly one TOC and no TOD
  // (the model no longer invents a descent onto the destination).
  expect(p.tocs.length).toBe(1);
  expect(p.tocs[0].leg).toBe(0);
  expect(p.tods).toBeUndefined();
  // Each leg keeps its own planned altitude — height changes along the course.
  expect(p.legs[0].cruiseAlt).toBe(3000);
  expect(p.legs[1].cruiseAlt).toBe(6000);
  expect(p.legs[2].cruiseAlt).toBe(6000);
  // Only the leg starting ON the field ramps; mid-route altitude changes are level,
  // and the last leg no longer descends into the field.
  expect(p.legs[0].climbDist).toBeGreaterThan(0);
  expect(p.legs[1].climbDist).toBe(0);
  expect(p.legs[last].descDist).toBe(0);
  // Climb cannot span past the first leg → TOC fraction is within (0,1].
  expect(p.tocs[0].frac).toBeGreaterThan(0);
  expect(p.tocs[0].frac).toBeLessThanOrEqual(1);
  expect(p.tocs[0].alt).toBe(3000);
  // Cumulative-NM axis data, one entry per waypoint (4 waypoints → 4).
  expect(p.wpCum.length).toBe(4);
  expect(p.totalDist).toBeGreaterThan(0);
});

test('TOC distance follows climb performance, and V/S never moves the clock', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.0, lng: 34.8, name: 'DEP' },
      { lat: 32.5, lng: 34.8, name: 'MID' },
      { lat: 33.0, lng: 34.8, name: 'DEST' },
    ];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 110; l.inboundAltitude = 3000; });
    routeEndpointElev = i => (i === 0 ? 1000 : i === state.legs.length ? 1000 : null);

    window.profileVS = 0;
    const slow = routeProfile({ gph: 8, climbFpm: 100, climbKt: 30 });
    window.profileVS = 1400;
    const fast = routeProfile({ gph: 8, climbFpm: 2000, climbKt: 200 });
    window.profileVS = 0;
    const stillAir = state.legs.reduce((acc, l, i) => {
      const g = geo(state.waypoints[i], state.waypoints[i + 1]);
      return acc + g.dist / l.flightSpeed;
    }, 0);
    return {
      slowToc: slow.legs[0].climbDist,
      fastToc: fast.legs[0].climbDist,
      tocFrac: slow.tocs[0].frac,
      firstLegDist: slow.legs[0].dist,
      slowTime: slow.totalTimeH, fastTime: fast.totalTimeH,
      slowFuel: slow.totalFuel, fastFuel: fast.totalFuel,
      stillAir,
    };
  });

  // Slow profile: 2000 ft at 100 fpm = 20 min; 30 kt for 20 min = 10 NM.
  expect(result.slowToc).toBeCloseTo(10, 5);
  expect(result.tocFrac).toBeCloseTo(10 / result.firstLegDist, 5);

  // A faster V/S shortens the drawn ramp...
  expect(result.fastToc).toBeLessThan(result.slowToc);
  expect(result.fastToc).toBeCloseTo(200 * (2000 / 1400) / 60, 5);

  // ...and changes NOTHING about time or fuel, which are distance and speed alone.
  expect(result.slowTime).toBeCloseTo(result.fastTime, 10);
  expect(result.slowTime).toBeCloseTo(result.stillAir, 10);
  expect(result.slowFuel).toBeCloseTo(result.fastFuel, 10);
});

test('a leg starting at a mid-route airfield climbs; its neighbours stay level', async ({ page }) => {
  await boot(page);
  const p = await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.3, lng: 34.9, name: 'FIELD' },
      { lat: 32.7, lng: 35.1, name: 'C' },
    ];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 110; l.inboundAltitude = 4000; });
    routeEndpointElev = i => (i === 1 ? 300 : null);   // only the middle point is a field
    return routeProfile({ gph: 8, climbFpm: 500, climbKt: 80 });
  });
  expect(p.legs[0].climbDist).toBe(0);          // does not start on a field
  expect(p.legs[1].climbDist).toBeGreaterThan(0);
  expect(p.tocs.length).toBe(1);
  expect(p.tocs[0].leg).toBe(1);
  expect(p.legs[1].startAlt).toBe(300);
});

test('flat route with no field has no TOC', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32, lng: 34.8, name: 'A' }, { lat: 32.4, lng: 35, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs[0].flightSpeed = 100; state.legs[0].inboundAltitude = 3000;
  });
  const p = await page.evaluate(() => routeProfile({ gph: 8 }));
  expect(p.tocs.length).toBe(0);
});

test('non-airfield endpoints: profile starts/ends at leg altitude, no TOC', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.2, lng: 34.9, name: 'B' },
      { lat: 32.6, lng: 35.1, name: 'C' }, { lat: 32.8, lng: 35.2, name: 'D' },
    ];
    state.legs = []; syncLegs();
    const a = [3000, 6000, 4000];
    state.legs.forEach((l, i) => { l.flightSpeed = 110; l.inboundAltitude = a[i]; });
    // No routeEndpointElev stub → synthetic waypoints are not airfields (null).
  });
  const p = await page.evaluate(() => routeProfile({ gph: 8 }));
  // No airfield anywhere → nothing to climb away from, no markers.
  expect(p.tocs.length).toBe(0);
  // Profile begins at the first leg's altitude and ends at the last leg's.
  expect(p.pts[0].alt).toBe(3000);
  expect(p.pts[p.pts.length - 1].alt).toBe(4000);
  expect(p.legs[0].climbDist).toBe(0);   // no climb-out from a (non-)field
});

test('flight plan modal renders the vertical-profile strip', async ({ page }) => {
  await boot(page);
  await seed(page);
  await page.evaluate(() => showFlightPlan());
  await expect(page.locator('.fp-profile-canvas')).toBeVisible();
  await expect(page.locator('.fp-profile-label')).toContainText(/profile/i);
  await expect(page.locator('.fp-profile-dir span').first()).toHaveText('A');
  await expect(page.locator('.fp-profile-dir span').last()).toHaveText('D');
  // TOC/TOD map markers turn on while the plan is open.
  expect(await page.evaluate(() => window.showProfile)).toBe(true);
  // The strip must paint on first open — not only after an edit. refresh()
  // runs before the modal is in the DOM, so the canvas was disconnected and
  // the draw bailed; a post-mount rAF redraw fixes it (#672 regression).
  const painted = await page.evaluate(async () => {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const c = document.querySelector('.fp-profile-canvas');
    const cx = c.getContext('2d');
    const px = cx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) return true;
    return false;
  });
  expect(painted).toBe(true);
});
