// #672 — top-of-climb / top-of-descent + vertical profile.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof routeProfile === 'function' && typeof showFlightPlan === 'function');
}

// 3 legs at 3000 / 6000 / 6000 ft. Each leg keeps its own altitude, so real
// height changes show along the course (leg 1 ramps gradually 3000→6000).
// Departure/destination field elevations are stubbed low so a TOC (climb-out,
// leg 0) and TOD (descent into the field, last leg) exist.
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

test('routeProfile: per-leg altitudes, one TOC on leg 1, one TOD on the last leg', async ({ page }) => {
  await boot(page);
  await seed(page);
  const p = await page.evaluate(() => routeProfile({ gph: 8, climbFpm: 700, descentFpm: 500, climbKt: 75, descentKt: 110 }));
  const last = p.legs.length - 1;
  // Exactly one TOC (climb-out, first leg) and one TOD (descent, last leg).
  expect(p.tocs.length).toBe(1);
  expect(p.tods.length).toBe(1);
  expect(p.tocs[0].leg).toBe(0);
  expect(p.tods[0].leg).toBe(last);
  // Each leg keeps its own planned altitude — height changes along the course.
  expect(p.legs[0].cruiseAlt).toBe(3000);
  expect(p.legs[1].cruiseAlt).toBe(6000);
  expect(p.legs[2].cruiseAlt).toBe(6000);
  // Leg 0 climbs out of the field; leg 1 ramps gradually up to 6000 (no marker);
  // the last leg descends to the field. Each transition is a ramp on its leg.
  expect(p.legs[0].climbDist).toBeGreaterThan(0);
  expect(p.legs[1].climbDist).toBeGreaterThan(0);
  expect(p.legs[last].descDist).toBeGreaterThan(0);
  // Climb cannot span past the first leg → TOC fraction is within (0,1].
  expect(p.tocs[0].frac).toBeGreaterThan(0);
  expect(p.tocs[0].frac).toBeLessThanOrEqual(1);
  expect(p.tocs[0].alt).toBe(3000);
  // Cumulative-NM axis data, one entry per waypoint (4 waypoints → 4).
  expect(p.wpCum.length).toBe(4);
  expect(p.totalDist).toBeGreaterThan(0);
});

test('TOC/TOD endpoint distances follow aircraft climb/descent performance', async ({ page }) => {
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
    const slow = routeProfile({ gph: 8, climbFpm: 100, descentFpm: 100, climbKt: 30, descentKt: 30 });
    window.profileVS = 1400;
    const fast = routeProfile({ gph: 8, climbFpm: 2000, descentFpm: 2000, climbKt: 200, descentKt: 200 });
    window.profileVS = 0;
    return {
      slowToc: slow.legs[0].climbDist,
      slowTod: slow.legs[1].descDist,
      fastToc: fast.legs[0].climbDist,
      fastTod: fast.legs[1].descDist,
      tocFrac: slow.tocs[0].frac,
      todFrac: slow.tods[0].frac,
      firstLegDist: slow.legs[0].dist,
      lastLegDist: slow.legs[1].dist,
    };
  });

  // Slow profile: 2000 ft at 100 fpm = 20 min; 30 kt for 20 min = 10 NM.
  expect(result.slowToc).toBeCloseTo(10, 5);
  expect(result.slowTod).toBeCloseTo(10, 5);
  expect(result.tocFrac).toBeCloseTo(10 / result.firstLegDist, 5);
  expect(result.todFrac).toBeCloseTo((result.lastLegDist - 10) / result.lastLegDist, 5);

  // Faster V/S and speed change endpoint marker distances too.
  expect(result.fastToc).toBeLessThan(result.slowToc);
  expect(result.fastTod).toBeLessThan(result.slowTod);
  expect(result.fastToc).toBeCloseTo(200 * (2000 / 1400) / 60, 5);
  expect(result.fastTod).toBeCloseTo(200 * (2000 / 1400) / 60, 5);
});

test('flat route (constant altitude) has no TOC/TOD', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32, lng: 34.8, name: 'A' }, { lat: 32.4, lng: 35, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs[0].flightSpeed = 100; state.legs[0].inboundAltitude = 3000;
  });
  const p = await page.evaluate(() => routeProfile({ gph: 8 }));
  expect(p.tocs.length).toBe(0);
  expect(p.tods.length).toBe(0);
});

test('non-airfield endpoints: profile starts/ends at leg altitude, no TOC/TOD', async ({ page }) => {
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
  // No airfield at either end → no climb-out / descent, no markers.
  expect(p.tocs.length).toBe(0);
  expect(p.tods.length).toBe(0);
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
