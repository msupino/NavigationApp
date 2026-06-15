// #672 — top-of-climb / top-of-descent + vertical profile.
const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof routeProfile === 'function' && typeof showFlightPlan === 'function');
}

// 3 legs; cruise = first leg's altitude (5500 ft) holds for the whole route.
// Departure/destination field elevations are stubbed low so the single climb
// (leg 0) and single descent (last leg) actually happen; middle leg stays flat.
async function seed(page) {
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.2, lng: 34.9, name: 'B' },
      { lat: 32.6, lng: 35.1, name: 'C' }, { lat: 32.8, lng: 35.2, name: 'D' },
    ];
    state.legs = []; syncLegs();
    // Per-leg altitudes vary, but only the first (5500) drives cruise now.
    const a = [5500, 8000, 3000];
    state.legs.forEach((l, i) => { l.flightSpeed = 110; l.inboundAltitude = a[i]; });
    // Stub field elevations: low departure/destination so cruise > field.
    routeEndpointElev = i => (i === 0 ? 500 : i === state.legs.length ? 800 : null);
  });
}

test('routeProfile climbs once on leg 1, holds cruise, descends once at the end', async ({ page }) => {
  await boot(page);
  await seed(page);
  const p = await page.evaluate(() => routeProfile({ gph: 8, climbFpm: 700, descentFpm: 500, climbKt: 75, descentKt: 110 }));
  const last = p.legs.length - 1;
  // Exactly one TOC (first leg) and one TOD (last leg) — no per-leg sawtooth.
  expect(p.tocs.length).toBe(1);
  expect(p.tods.length).toBe(1);
  expect(p.tocs[0].leg).toBe(0);
  expect(p.tods[0].leg).toBe(last);
  // Single cruise altitude = first leg's planned altitude.
  expect(p.legs[0].cruiseAlt).toBe(5500);
  expect(p.legs[1].cruiseAlt).toBe(5500);
  // Climb only on leg 0, descent only on the last leg; middle leg is flat.
  expect(p.legs[0].climbDist).toBeGreaterThan(0);
  expect(p.legs[0].descDist).toBe(0);
  expect(p.legs[1].climbDist).toBe(0);
  expect(p.legs[1].descDist).toBe(0);
  expect(p.legs[last].descDist).toBeGreaterThan(0);
  expect(p.legs[last].climbDist).toBe(0);
  const toc = p.tocs[0];
  expect(toc.frac).toBeGreaterThan(0);
  expect(toc.alt).toBe(5500);
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
