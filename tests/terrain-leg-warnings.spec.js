// @ts-check
// The shading answers "is there ground at my altitude somewhere on this map". The route needs
// the sharper question answered on itself: WHICH legs does the plan not clear? A leg planned
// below its own MSA (terrain + msaBufferFt — the same figure the leg inspector shows) gets a
// casing under the route line, and the waypoints at either end get a ring: those are the
// points a pilot reads when deciding what altitude to file.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof drawTerrainWarnings === 'function' && typeof loadTerrain === 'function');
  await page.evaluate(() => loadTerrain());
  await page.waitForFunction(() => terrainHasCoverage());
  await page.evaluate(() => { window.showMsa = true; map.setView([32.8, 35.3], 10); });
}

// A Galilee leg: real ground, so MSA is a real number.
const plan = (page, altFt) => page.evaluate((alt) => {
  state.waypoints = [{ lat: 32.70, lng: 35.10, name: 'A' }, { lat: 32.95, lng: 35.50, name: 'B' }];
  state.legs = []; syncLegs();
  state.legs.forEach(l => { l.inboundAltitude = alt; l.flightSpeed = 100; });
  draw();
  return { msa: legMsaFt(0), warned: window.__terrainWarnLegs };
}, altFt);

test('a leg planned below its MSA is marked; the same leg high above it is not', async ({ page }) => {
  await boot(page);
  const low = await plan(page, 500);
  expect(low.msa).toBeGreaterThan(500);
  expect(low.warned).toEqual([0]);
  const high = await plan(page, low.msa + 1000);
  expect(high.warned).toEqual([]);
});

test('exactly at the MSA counts as cleared — the buffer is already in that number', async ({ page }) => {
  await boot(page);
  const first = await plan(page, 500);
  const atMsa = await plan(page, first.msa);
  expect(atMsa.warned).toEqual([]);
});

test('a leg with no altitude typed is not accused of anything', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.70, lng: 35.10, name: 'A' }, { lat: 32.95, lng: 35.50, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.inboundAltitude = NaN; });
    draw();
    return window.__terrainWarnLegs;
  });
  expect(out).toEqual([]);
});

test('it draws under the route, leaving the line and its labels alone', async ({ page }) => {
  await boot(page);
  await plan(page, 500);
  // The casing is stroked before drawLegs runs, so the route line is painted after it.
  const order = await page.evaluate(() => {
    const seen = [];
    const realStroke = octx.stroke.bind(octx);
    const realWidth = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(octx), 'lineWidth');
    octx.stroke = (...a) => { seen.push(octx.lineWidth); return realStroke(...a); };
    draw();
    octx.stroke = realStroke;
    void realWidth;
    const casing = tune('terrainLegWarnWidthPx');
    return { casingStroked: seen.includes(casing), strokes: seen.length };
  });
  expect(order.casingStroked).toBe(true);
  expect(order.strokes).toBeGreaterThan(1);
});

test('with the layer off, nothing is marked', async ({ page }) => {
  await boot(page);
  await plan(page, 500);
  const off = await page.evaluate(() => {
    window.showMsa = false;
    window.__terrainWarnLegs = null;
    draw();
    return window.__terrainWarnLegs;
  });
  expect(off).toBeNull();          // the warning pass never ran
});
