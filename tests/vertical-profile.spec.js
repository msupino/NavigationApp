// #672 — top-of-climb / top-of-descent + vertical profile.
const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof routeProfile === 'function' && typeof showFlightPlan === 'function');
}

// 3 legs at 5500 / 8000 / 3000 ft. Each leg keeps its own altitude (real
// height changes show along the course). Departure/destination field
// elevations are stubbed low so a TOC (climb-out, leg 0) and TOD (descent,
// last leg) exist; the middle leg has no climb/descent (no marker).
async function seed(page) {
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.2, lng: 34.9, name: 'B' },
      { lat: 32.6, lng: 35.1, name: 'C' }, { lat: 32.8, lng: 35.2, name: 'D' },
    ];
    state.legs = []; syncLegs();
    const a = [5500, 8000, 3000];
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
  expect(p.legs[0].cruiseAlt).toBe(5500);
  expect(p.legs[1].cruiseAlt).toBe(8000);
  expect(p.legs[2].cruiseAlt).toBe(3000);
  // Climb confined to leg 0, descent to the last leg; middle leg has neither.
  expect(p.legs[0].climbDist).toBeGreaterThan(0);
  expect(p.legs[1].climbDist).toBe(0);
  expect(p.legs[1].descDist).toBe(0);
  expect(p.legs[last].descDist).toBeGreaterThan(0);
  // Climb cannot span past the first leg → TOC fraction is within (0,1].
  expect(p.tocs[0].frac).toBeGreaterThan(0);
  expect(p.tocs[0].frac).toBeLessThanOrEqual(1);
  expect(p.tocs[0].alt).toBe(5500);
  // Cumulative-NM axis data, one entry per waypoint (4 waypoints → 4).
  expect(p.wpCum.length).toBe(4);
  expect(p.totalDist).toBeGreaterThan(0);
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
