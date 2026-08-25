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
    const r = await fetch('data/airspace.json?v=2');
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
    const d = await (await fetch('data/airspace.json?v=2')).json();
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

// --- the inspector ----------------------------------------------------------
// An outline on a chart raises questions it cannot answer: what kind of airspace is this,
// how high does it reach, is it in force now, who do I call. The AIP prints all of it in
// the columns beside the boundary; the panel is where that ends up.
const openArea = (page, id) => page.evaluate(async (want) => {
  await loadAirspace();
  const i = window.airspace.findIndex(a => a.id === want);
  state.selected = { type: 'airspace', index: i };
  showInspector();
  const rows = {};
  for (const r of document.querySelectorAll('#insp-body .row')) {
    const l = r.querySelector('label'), v = r.querySelector('.val');
    if (l && v) rows[l.textContent.trim()] = v.textContent.trim();
  }
  return { title: document.getElementById('insp-title').value, rows };
}, id);

test('a restricted area says what it is, when, and what it is for', async ({ page }) => {
  await boot(page);
  await turnOn(page);
  const out = await openArea(page, 'LLR01');
  expect(out.rows.Class).toBe('Restricted — conditional');
  expect(out.rows['Vertical limits']).toMatch(/7000/);
  expect(out.rows['Vertical limits']).toMatch(/40000/);
  expect(out.rows.Activity).toMatch(/Training/);
  expect(out.rows.Activity).toMatch(/Military/);
  expect(out.rows.Hours).toMatch(/Sun 06:15/);
  expect(out.rows.Notes).toMatch(/IDF\/AF Training Areas/);
  expect(out.rows.Source).toBe('AIP ENR 5.1');
  expect(out.rows.Size).toMatch(/nm²/);
});

test('a prohibited area says closed, and an H24 one says it is active now', async ({ page }) => {
  await boot(page);
  await turnOn(page);
  const out = await openArea(page, 'LLP03');
  expect(out.rows.Class).toBe('Prohibited — closed');
  expect(out.rows.Hours).toMatch(/H24/);
  expect(out.rows.Hours).toMatch(/active now/);
});

test('an area activated by NOTAM says so, and carries its name', async ({ page }) => {
  await boot(page);
  await turnOn(page);
  const out = await openArea(page, 'LLR27');
  expect(out.title).toMatch(/Eilat/);            // the AIP's own quoted name, not just LLR27
  expect(out.rows.Activation).toBe('By NOTAM');
});

// The frequency is the difference between a wall and a clearance.
test('a TMA sector carries the frequencies for its controller', async ({ page }) => {
  await boot(page);
  await turnOn(page);
  const out = await openArea(page, 'LLBG-TMA-WESTERNSECTO');
  expect(out.rows.Class).toBe('Controlled — clearance required');
  const labels = Object.keys(out.rows).join(' ');
  expect(labels).toMatch(/APP\/DEP control/);
  expect(Object.values(out.rows).join(' ')).toMatch(/120\.500/);
  expect(Object.values(out.rows).join(' ')).toMatch(/119\.500/);
});

// "H24" is decidable; "Sun SR - Sun SS" is not, and a confident wrong answer about whether
// a live-fire area is cold is the one mistake this panel must not make.
test('active-now is decided only where the printed hours decide it', async ({ page }) => {
  await boot(page);
  const verdicts = await page.evaluate(() => {
    const at = (iso) => new Date(iso);
    return {
      h24: airspaceActiveNow({ hours: ['H24'] }),
      inWindow: airspaceActiveNow({ hours: ['Sun 04:00 (UTCW) - Thu 19:00 (UTCW)'] }, at('2026-08-25T10:00:00Z')),
      outOfWindow: airspaceActiveNow({ hours: ['Sun 04:00 (UTCW) - Thu 19:00 (UTCW)'] }, at('2026-08-28T20:00:00Z')),
      sunrise: airspaceActiveNow({ hours: ['Sun SR - Sun SS'] }),
      none: airspaceActiveNow({ hours: [] }),
    };
  });
  expect(verdicts.h24).toBe(true);
  expect(verdicts.inWindow).toBe(true);          // Tuesday 10:00Z is inside Sun 04:00–Thu 19:00
  expect(verdicts.outOfWindow).toBe(false);      // Friday 20:00Z is not
  expect(verdicts.sunrise).toBeNull();           // sunrise/sunset: not decidable from the text
  expect(verdicts.none).toBeNull();
});

// The limits matter more than the outline: a leg crossing an area on the map may be well
// above or below it, and saying "crosses" without saying that would read as a warning.
test('the panel compares the planned route against the limits', async ({ page }) => {
  await boot(page);
  await turnOn(page);
  const verdicts = await page.evaluate(async () => {
    await loadAirspace();
    const a = window.airspace.find(x => x.id === 'LLR01');   // 7000 – 40000 ft
    // A leg straight through the middle of it, at three different altitudes.
    const mid = a.ring.reduce((acc, p) => [acc[0] + p[0] / a.ring.length, acc[1] + p[1] / a.ring.length], [0, 0]);
    const put = (alt) => {
      state.waypoints = [{ lat: mid[0] - 0.15, lng: mid[1], name: 'A' },
                         { lat: mid[0] + 0.15, lng: mid[1], name: 'B' }];
      syncLegs();
      state.legs.forEach(l => { l.altitude = alt; l.inboundAltitude = alt; });
      return airspaceRouteVerdict(a);
    };
    const inside = put(10000);
    const below = put(3000);
    state.waypoints = [{ lat: 29.6, lng: 34.95, name: 'A' }, { lat: 29.7, lng: 35.0, name: 'B' }];
    syncLegs();
    const clear = airspaceRouteVerdict(a);
    return { inside, below, clear };
  });
  expect(verdicts.inside).toMatch(/inside its limits/);
  expect(verdicts.below).toMatch(/below the base/);
  expect(verdicts.clear).toMatch(/clear of it/);
});

// --- CTRs (AD 2.17) ---------------------------------------------------------
// The control zones every VFR flight into a controlled field has to talk through. They live
// in each aerodrome's own AD 2.17 block, not in ENR 5.1 — which is why the app had a
// ctr-boundaries.json that was a list of reporting-point names rather than geometry.
test('the four CTRs are there, with their own class and ceiling', async ({ page }) => {
  await boot(page);
  const ctrs = await page.evaluate(async () => {
    const d = await (await fetch('data/airspace.json?v=2')).json();
    return d.areas.filter(a => a.kind === 'ctr').map(a => ({
      id: a.id, upper: a.upperFt, lower: a.lowerFt, pts: a.ring.length,
      area: a.areaNm2, source: a.source,
    }));
  });
  const byId = Object.fromEntries(ctrs.map(c => [c.id, c]));
  expect(Object.keys(byId).sort()).toEqual(
    ['LLBG-CTR', 'LLER-CTR-NORTH', 'LLER-CTR-SOUTH', 'LLHA-CTR']);
  expect(byId['LLBG-CTR'].upper).toBe(2000);           // SFC to 2 000 FT MSL
  expect(byId['LLHA-CTR'].upper).toBe(3000);
  expect(byId['LLER-CTR-NORTH'].upper).toBe(4000);     // the two halves differ...
  expect(byId['LLER-CTR-SOUTH'].upper).toBe(6000);     // ...and each takes its own ceiling
  for (const c of ctrs) {
    expect(c.lower).toBe(0);                           // SFC, all of them
    expect(c.source).toBe('AIP AD 2.17');
    expect(c.area).toBeGreaterThan(10);
  }
});

// Eilat's CTR is drawn partly along the Israel/Jordan and Israel/Egypt borders — prose, not
// coordinates. The border is data the app already carries for NOTAM areas, so the stretch
// between the two named corners is traced rather than guessed.
test('a CTR that runs along the border is traced from the border data', async ({ page }) => {
  await boot(page);
  const shape = await page.evaluate(async () => {
    const d = await (await fetch('data/airspace.json?v=2')).json();
    const south = d.areas.find(a => a.id === 'LLER-CTR-SOUTH');
    const lats = south.ring.map(p => p[0]);
    const lngs = south.ring.map(p => p[1]);
    return { pts: south.ring.length, minLat: Math.min(...lats), maxLat: Math.max(...lats),
             minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
  });
  // Many more vertices than the handful of printed corners: the traced border is in there.
  expect(shape.pts).toBeGreaterThan(20);
  // ...and it stays where Eilat is, rather than wandering off along the whole frontier.
  expect(shape.minLat).toBeGreaterThan(29.3);
  expect(shape.maxLat).toBeLessThan(30.1);
  expect(shape.minLng).toBeGreaterThan(34.7);
  expect(shape.maxLng).toBeLessThan(35.2);
});

test('a CTR reads as a control zone, in its own colour', async ({ page }) => {
  await boot(page);
  await turnOn(page);
  const out = await openArea(page, 'LLBG-CTR');
  expect(out.title).toMatch(/Ben-Gurion CTR/);
  expect(out.rows.Class).toBe('Control zone — clearance required');
  expect(out.rows['Vertical limits']).toMatch(/GND/);
  expect(out.rows['Vertical limits']).toMatch(/2000/);
  const colour = await page.evaluate(() => airspaceColor('ctr'));
  expect(colour).toBe('#1c7c74');
  expect(colour).not.toBe(await page.evaluate(() => airspaceColor('tma')));
});
