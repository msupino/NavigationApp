// @ts-check
// The flight-plan profile strip drew the plan against nothing: an altitude line over empty
// background. The terrain grid the MSA figures already come from is now drawn under it, with
// a dashed safe-altitude line above the ground — so "2000 ft over ground that reaches 2600"
// is something you can see rather than something you work out per leg.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof routeProfile === 'function' &&
    typeof profileTerrainSamples === 'function' && typeof loadTerrain === 'function');
  await page.evaluate(() => loadTerrain());
  await page.waitForFunction(() => typeof terrainHasCoverage === 'function' && terrainHasCoverage());
}

// A route across the Galilee, where the ground actually rises.
const route = (page) => page.evaluate(() => {
  state.waypoints = [
    { lat: 32.70, lng: 35.00, name: 'A' },
    { lat: 32.95, lng: 35.50, name: 'B' },
  ];
  state.legs = []; syncLegs();
  state.legs.forEach(l => { l.inboundAltitude = 2000; l.flightSpeed = 100; });
  draw();
  return routeProfile(undefined, state.legs.map((_, i) => i)).totalDist;
});

test('the terrain under the route is sampled across its whole length', async ({ page }) => {
  await boot(page);
  const total = await route(page);
  const s = await page.evaluate(() => {
    const prof = routeProfile(undefined, state.legs.map((_, i) => i));
    const t = profileTerrainSamples(prof);
    return { n: t.length, first: t[0].d, last: t[t.length - 1].d,
             known: t.filter(x => x.ft != null).length,
             max: Math.max(...t.filter(x => x.ft != null).map(x => x.ft)) };
  });
  expect(s.n).toBe(Math.round(await page.evaluate(() => tune('profileTerrainSamples'))) + 1);
  expect(s.first).toBeCloseTo(0, 3);
  expect(s.last).toBeCloseTo(total, 3);
  expect(s.known).toBe(s.n);                 // this route is inside the grid
  expect(s.max).toBeGreaterThan(300);        // real ground, not a flat zero
});

test('a sample outside the grid is a gap, not a guess', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.70, lng: 35.00, name: 'A' },
      { lat: 36.50, lng: 40.00, name: 'FAR' },     // well outside the covered box
    ];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.inboundAltitude = 2000; l.flightSpeed = 100; });
    const t = profileTerrainSamples(routeProfile(undefined, state.legs.map((_, i) => i)));
    return { total: t.length, gaps: t.filter(x => x.ft == null).length };
  });
  expect(out.gaps).toBeGreaterThan(0);
  expect(out.gaps).toBeLessThan(out.total);    // the near end is still drawn
});

test('with no coverage there is no silhouette at all', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof profileTerrainSamples === 'function');
  const t = await page.evaluate(() => {
    terrainGrid = { coverage: false };            // as a deployment without the grid boots
    state.waypoints = [{ lat: 32.7, lng: 35.0, name: 'A' }, { lat: 32.9, lng: 35.3, name: 'B' }];
    state.legs = []; syncLegs();
    return profileTerrainSamples(routeProfile(undefined, state.legs.map((_, i) => i)));
  });
  expect(t).toBeNull();                          // never a flat zero line pretending to be ground
});

test('the strip makes room for terrain that rises above the plan', async ({ page }) => {
  await boot(page);
  await route(page);
  // Draw into a canvas and read the vertical extent the terrain fill reached: with the plan
  // at 2000 ft and ground+buffer above it, the silhouette must not be clipped at the top.
  const out = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 600; c.height = 200;
    const ctx = c.getContext('2d');
    let minY = Infinity;
    const realLineTo = ctx.lineTo.bind(ctx);
    ctx.lineTo = (x, y) => { if (y < minY) minY = y; return realLineTo(x, y); };
    drawVerticalProfile(ctx, 0, 0, c.width, c.height);
    return { minY, height: c.height };
  });
  expect(out.minY).toBeGreaterThanOrEqual(0);    // nothing drawn above the strip
  expect(out.minY).toBeLessThan(out.height);
});
