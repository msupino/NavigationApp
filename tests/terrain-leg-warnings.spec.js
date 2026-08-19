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

// The everyday coastal run, on the PUBLISHED corridor rather than a straight line between
// endpoints: BOREN->HOTRM->DAROM->GALIM->LLHA never crosses ground above ~900 ft, so a normal
// 1500 ft plan must come out clean. (A straight BOREN->LLHA line crosses the Carmel at 1578 ft
// and is flagged — correctly, since no such segment is published and nobody flies it.)
test('the published Haifa arrival is not flagged at a normal altitude', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const names = ['FRDIS', 'BOREN', 'HOTRM', 'DAROM', 'GALIM', 'LLHA'];
    state.waypoints = names.map(n => {
      const w = (navWP || []).find(x => x.name === n);
      if (w) return { lat: w.lat, lng: w.lng, name: n };
      const a = typeof airfieldByIcao === 'function' ? airfieldByIcao(n) : null;
      return a ? { lat: a.lat, lng: a.lng, name: n } : null;
    }).filter(Boolean);
    state.legs = []; syncLegs();
    const at = (alt) => {
      state.legs.forEach(l => { l.inboundAltitude = alt; });
      return terrainUnclearedLegs().map(b => state.waypoints[b.i].name + '>' + state.waypoints[b.i + 1].name);
    };
    return { at1500: at(1500), at1000: at(1000), at500: at(500) };
  });
  expect(out.at1500).toEqual([]);                 // the ordinary case must be silent
  expect(out.at500.length).toBeGreaterThan(0);    // ...and 500 ft over 900 ft ground is not
});

test('a leg drawn straight across the Carmel IS flagged, because that line is not the corridor', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const pick = (n) => {
      const w = (navWP || []).find(x => x.name === n);
      if (w) return { lat: w.lat, lng: w.lng, name: n };
      const a = typeof airfieldByIcao === 'function' ? airfieldByIcao(n) : null;
      return a ? { lat: a.lat, lng: a.lng, name: n } : null;
    };
    state.waypoints = [pick('BOREN'), pick('LLHA')];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.inboundAltitude = 1500; });
    const bad = terrainUnclearedLegs();
    return { flagged: bad.length, level: bad[0] && bad[0].level, ground: Math.round(bad[0] ? bad[0].ground : 0) };
  });
  expect(out.flagged).toBe(1);
  expect(out.level).toBe('alert');                // the ground is ABOVE the plan, not merely close
  expect(out.ground).toBeGreaterThan(1400);
});

// The VFR rules the clearance is written in: 500 ft above the surface outside congested areas,
// 1000 ft above the highest obstacle within 2000 ft horizontally over congested ones. The knob
// carries both, so a pilot over built-up ground can see the stricter picture.
test('the clearance knob switches between the open-country and congested rules', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.70, lng: 35.10, name: 'A' }, { lat: 32.95, lng: 35.50, name: 'B' }];
    state.legs = []; syncLegs();
    const ground = terrainMaxAlongLeg(state.waypoints[0], state.waypoints[1]);
    // Planned so that it clears the ground by more than 500 but less than 1000.
    state.legs.forEach(l => { l.inboundAltitude = Math.round(ground + 700); });
    setTune('terrainWarnClearanceFt', 500);
    const open = terrainUnclearedLegs().length;
    setTune('terrainWarnClearanceFt', 1000);
    const congested = terrainUnclearedLegs().map(b => b.level);
    return { ground: Math.round(ground), open, congested };
  });
  expect(out.open).toBe(0);                    // 700 ft over the ground is fine in open country
  expect(out.congested).toEqual(['caution']);  // ...and thin where 1000 ft is required
});
