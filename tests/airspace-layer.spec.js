// @ts-check
// Airspace from the AIP: prohibited (LLP*) and restricted (LLR*) areas from ENR 5.1, and
// the Ben-Gurion TMA sectors from ENR 2.1. Drawn under everything else, with each area's
// identifier and vertical limits — the boundary is lateral only, so the limits are the half
// of the answer a pilot actually needs before deciding whether a leg is a problem.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof loadAirspace === 'function');
}

const turnOn = (page) => page.evaluate(async () => {
  const cb = document.getElementById('airspace-cb');
  cb.checked = true;
  cb.dispatchEvent(new Event('change', { bubbles: true }));
  await loadAirspace();
  map.setView([32.0, 34.9], 10);
  draw();
});

test('the dataset is real: 46 areas, closed rings, all inside the country', async ({ page }) => {
  await boot(page);
  const d = await page.evaluate(async () => {
    const r = await fetch('data/airspace.json?v=1');
    return r.json();
  });
  expect(d.areas.length).toBeGreaterThanOrEqual(40);
  const kinds = {};
  for (const a of d.areas) kinds[a.kind] = (kinds[a.kind] || 0) + 1;
  expect(kinds.prohibited).toBeGreaterThan(10);
  expect(kinds.restricted).toBeGreaterThan(15);
  expect(kinds.tma).toBeGreaterThan(5);
  for (const a of d.areas) {
    expect(a.ring.length).toBeGreaterThanOrEqual(3);
    for (const [lat, lng] of a.ring) {
      expect(lat).toBeGreaterThan(29);
      expect(lat).toBeLessThan(34);
      expect(lng).toBeGreaterThan(33);
      expect(lng).toBeLessThan(36.5);
    }
  }
  // Every area carries the two numbers that decide whether a leg is a problem.
  const noLimits = d.areas.filter(a => a.upperFt === null && a.lowerFt === null);
  expect(noLimits).toEqual([]);
});

// A circle in the AIP ("A circle radius 6 KM centered on…") has to come out a circle.
test('circles and arcs survive the trip from prose to geometry', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    const d = await (await fetch('data/airspace.json?v=1')).json();
    const byId = Object.fromEntries(d.areas.map(a => [a.id, a]));
    const R = 6371;
    const km = (a, b) => {
      const dLat = (b[0] - a[0]) * Math.PI / 180;
      const dLng = (b[1] - a[1]) * Math.PI / 180;
      const la = (a[0] + b[0]) / 2 * Math.PI / 180;
      return Math.hypot(dLat, dLng * Math.cos(la)) * R;
    };
    const ring = byId.LLP13.ring;                 // "A circle radius 6 KM"
    const c = ring.reduce((acc, p) => [acc[0] + p[0] / ring.length, acc[1] + p[1] / ring.length], [0, 0]);
    const radii = ring.map(p => km(c, p));
    return {
      n: ring.length,
      minR: Math.min(...radii),
      maxR: Math.max(...radii),
      arcPoints: byId.LLR20.ring.length,          // a 1.6 NM arc, densely sampled
    };
  });
  expect(out.n).toBeGreaterThan(30);
  expect(out.minR).toBeGreaterThan(5.5);
  expect(out.maxR).toBeLessThan(6.5);             // 6 km, to within the sampling
  expect(out.arcPoints).toBeGreaterThan(20);
});

test('the layer ships off, and the toggle turns it on', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => showAirspace)).toBe(false);
  expect(await page.evaluate(() => document.getElementById('airspace-cb').checked)).toBe(false);
  await turnOn(page);
  expect(await page.evaluate(() => showAirspace)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('navaid.showAirspace'))).toBe('1');
  expect(await page.evaluate(() => (window.airspace || []).length)).toBeGreaterThan(40);
});

test('nothing is fetched while the layer is off', async ({ page }) => {
  let asked = 0;
  await page.route(/data\/airspace\.json/, r => { asked++; r.continue(); });
  await boot(page);
  await page.evaluate(() => { map.setView([32.0, 34.9], 10); draw(); });
  await page.waitForTimeout(300);
  expect(asked).toBe(0);
});

test('it paints, and the paint is the tuned colour', async ({ page }) => {
  await boot(page);
  await turnOn(page);
  const drawn = await page.evaluate(async () => {
    // Count the strokes rather than sample pixels: a chart underneath makes colour
    // sampling a lottery, and what matters is that each area was drawn once.
    const calls = { stroke: 0, fill: 0, colours: new Set() };
    const ctx = octx;                       // the overlay context every layer paints on
    const realStroke = ctx.stroke.bind(ctx), realFill = ctx.fill.bind(ctx);
    Object.defineProperty(ctx, 'stroke', { value: () => { calls.stroke++; calls.colours.add(ctx.strokeStyle); realStroke(); }, configurable: true });
    Object.defineProperty(ctx, 'fill', { value: () => { calls.fill++; realFill(); }, configurable: true });
    drawAirspace();
    return { stroke: calls.stroke, fill: calls.fill, colours: [...calls.colours] };
  });
  expect(drawn.stroke).toBeGreaterThan(40);
  expect(drawn.fill).toBeGreaterThan(40);
  expect(drawn.colours).toEqual(expect.arrayContaining(['#c0392b', '#b06a00', '#2a63b5']));
});

test('labels wait for a zoom where they can be read', async ({ page }) => {
  await boot(page);
  await turnOn(page);
  const texts = (z) => page.evaluate(async (zoom) => {
    map.setView([32.0, 34.9], zoom);
    const seen = [];
    const ctx = octx;
    const real = ctx.fillText.bind(ctx);
    Object.defineProperty(ctx, 'fillText', { value: (t, x, y) => { seen.push(String(t)); real(t, x, y); }, configurable: true });
    drawAirspace();
    return seen;
  }, z);
  expect(await texts(7)).toEqual([]);                       // country view: outlines only
  const close = await texts(11);
  expect(close.some(t => /^LL[PR]\d+/.test(t))).toBe(true);  // an identifier
  expect(close.some(t => /–/.test(t))).toBe(true);           // ...and its vertical limits
  // A TMA sector wears a short name: a sliced "LLBG-TMA-WESTERNSECTO" is not a label.
  expect(close.some(t => /^BG TMA /.test(t))).toBe(true);
  expect(close.some(t => /^LLBG-TMA/.test(t))).toBe(false);
});
