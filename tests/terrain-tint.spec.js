// @ts-check
// "Show MSA" used to sit in View/Set and draw nothing on the map: its only effect was one
// read-only row in the leg inspector, so a pilot toggling it saw no change at all.
//
// It is now "Terrain vs altitude" in Extra layers. The first attempt painted every hill by
// height, which was the wrong picture — the chart underneath already shows relief, so a second
// brown wash hid the chart to repeat what it said. It paints only the ground that reaches the
// altitude being planned: red at or above it, amber inside the safety buffer below it, and
// nothing anywhere else. A route planned well clear of the terrain paints nothing at all.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof drawTerrainTint === 'function' && typeof loadTerrain === 'function');
  await page.evaluate(() => loadTerrain());
  await page.waitForFunction(() => terrainHasCoverage());
  await page.evaluate(() => { map.setView([32.8, 35.3], 10); });
}

// A route with a planned altitude, which is what the shading is measured against.
const planRoute = (page, altFt) => page.evaluate((alt) => {
  state.waypoints = [{ lat: 32.70, lng: 35.10, name: 'A' }, { lat: 32.95, lng: 35.50, name: 'B' }];
  state.legs = []; syncLegs();
  state.legs.forEach(l => { l.inboundAltitude = alt; l.flightSpeed = 100; });
  state.selected = null;
  draw();
}, altFt);

// Count the quads the tint actually filled this frame.
const quads = (page) => page.evaluate(() => {
  let fills = 0;
  const real = octx.fill.bind(octx);
  octx.fill = (...a) => { fills++; return real(...a); };
  drawTerrainTint();
  octx.fill = real;
  return fills;
});

test('the toggle lives in Extra layers, not View/Set', async ({ page }) => {
  await boot(page);
  const where = await page.evaluate(() => {
    const cb = document.getElementById('msa-cb');
    const sec = cb.closest('.tb-section') || cb.closest('[data-sec]');
    return { group: !!cb.closest('#terrain-group'), section: sec ? (sec.dataset.sec || sec.id || '') : '' };
  });
  expect(where.group).toBe(true);
});

test('ground at the planned altitude is painted; ground well below it is not', async ({ page }) => {
  await boot(page);
  await planRoute(page, 500);              // below the Galilee ridges: they threaten this plan
  const low = await quads(page);
  await planRoute(page, 9000);             // nothing in Israel reaches this
  const high = await quads(page);
  expect(low).toBeGreaterThan(20);
  expect(high).toBe(0);                    // the chart is left alone, which is the point
});

test('with no planned altitude there is nothing to compare, so nothing is drawn', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.70, lng: 35.10, name: 'A' }, { lat: 32.95, lng: 35.50, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.inboundAltitude = NaN; });
    draw();
  });
  expect(await quads(page)).toBe(0);
});

test('red for ground at or above the plan, amber for the clearance below it', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    // terrainWarnClearanceFt, not msaBufferFt: MSA is terrain + 1000 ft, and using it here
    // flagged every everyday CVFR leg.
    const buf = tune('terrainWarnClearanceFt');
    return {
      above: terrainShadeColor(2100, 2000),
      atIt: terrainShadeColor(2000, 2000),
      inBuffer: terrainShadeColor(2000 - buf + 100, 2000),
      clear: terrainShadeColor(2000 - buf - 500, 2000),
      alert: tune('terrainAlertColor'), caution: tune('terrainCautionColor'),
    };
  });
  expect(out.above).toContain('rgba');
  expect(out.atIt).toBe(out.above);
  expect(out.inBuffer).not.toBe(out.above);
  expect(out.inBuffer).toContain('rgba');
  expect(out.clear).toBeNull();            // safely below: nothing painted
});

test('the selected leg decides the altitude, else the lowest on the route', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.7, lng: 35.1, name: 'A' }, { lat: 32.8, lng: 35.3, name: 'B' },
                       { lat: 32.95, lng: 35.5, name: 'C' }];
    state.legs = []; syncLegs();
    state.legs[0].inboundAltitude = 4500;
    state.legs[1].inboundAltitude = 2000;
    state.selected = null;
    const lowest = terrainReferenceAltFt();
    state.selected = { type: 'leg', index: 0 };
    const selected = terrainReferenceAltFt();
    return { lowest, selected };
  });
  expect(out.lowest).toBe(2000);           // the leg that decides whether the plan is flyable
  expect(out.selected).toBe(4500);         // ...unless you are looking at one
});

// The whole-route view (zoom 8-9) is exactly where a pilot looks, and a zoom floor made it
// the one view that drew nothing at all — reported as "doesn't seem to do anything". Cells
// are merged into legible blocks there instead of being skipped.
test('it draws at every zoom, including the whole-route view', async ({ page }) => {
  await boot(page);
  await planRoute(page, 500);              // a plan the ridges threaten, so there is something to draw
  const perZoom = await page.evaluate(async () => {
    const out = {};
    for (const z of [8, 9, 10, 12, 13]) {
      map.setView([32.7, 35.2], z);
      await new Promise(r => setTimeout(r, 60));
      drawTerrainTint();
      out[z] = window.__terrainTintCells;
    }
    return out;
  });
  for (const [z, n] of Object.entries(perZoom)) expect(n, 'zoom ' + z).toBeGreaterThan(50);
});

test('zoomed out it merges cells rather than drawing thousands of invisible ones', async ({ page }) => {
  await boot(page);
  await planRoute(page, 500);
  const out = await page.evaluate(async () => {
    map.setView([32.7, 35.2], 8);
    await new Promise(r => setTimeout(r, 60));
    drawTerrainTint();
    const merged = window.__terrainTintCells;
    setTune('terrainTintMinCellPx', 2);          // ask for near-raw cells
    drawTerrainTint();
    return { merged, raw: window.__terrainTintCells };
  });
  expect(out.merged).toBeLessThan(out.raw);      // blocks, not one quad per grid cell
});

test('the knob can still switch it off below a zoom', async ({ page }) => {
  await boot(page);
  const off = await page.evaluate(() => {
    setTune('terrainTintMinZoom', 14);
    window.__terrainTintCells = -1;               // so an early return is distinguishable
    drawTerrainTint();
    return window.__terrainTintCells;
  });
  expect(off).toBe(-1);            // returned before painting anything
});

test('no coverage means no tint, not a flat colour', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof drawTerrainTint === 'function');
  const fills = await page.evaluate(() => {
    terrainGrid = { coverage: false };
    let n = 0;
    const real = octx.fill.bind(octx);
    octx.fill = (...a) => { n++; return real(...a); };
    drawTerrainTint();
    octx.fill = real;
    return n;
  });
  expect(fills).toBe(0);
});

test('the leg inspector still carries the MSA row it always did', async ({ page }) => {
  await boot(page);
  const hasRow = await page.evaluate(() => {
    window.showMsa = true;
    state.waypoints = [{ lat: 32.70, lng: 35.10, name: 'A' }, { lat: 32.95, lng: 35.45, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.inboundAltitude = 2000; l.flightSpeed = 100; });
    state.selected = { type: 'leg', index: 0 };
    showInspector();
    return /MSA/i.test(document.getElementById('insp-body').textContent);
  });
  expect(hasRow).toBe(true);
});

// Ticking the box has to repaint. It used to only rebuild the inspector — correct when the
// toggle drew nothing on the map, and indistinguishable from a dead control now that it does.
test('ticking the toggle paints immediately, without waiting for a pan', async ({ page }) => {
  await boot(page);
  await planRoute(page, 500);
  const out = await page.evaluate(() => {
    window.showMsa = false;
    const cb = document.getElementById('msa-cb');
    cb.checked = false;
    window.__terrainTintCells = 0;
    cb.checked = true;
    cb.onchange({ target: cb });          // exactly what a click does
    return { on: !!window.showMsa, cells: window.__terrainTintCells };
  });
  expect(out.on).toBe(true);
  expect(out.cells).toBeGreaterThan(50);
});

// The rule that trails a group / frame title is a ::after block, and only the standalone
// .tb-group-separator had a light-theme colour — so on a light background those lines stayed
// dark-theme charcoal while every other separator went pale grey. Reported as "the line above
// Terrain doesn't look like the other separators".
test('in light theme every toolbar separator is the same colour', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForSelector('#msa-cb', { state: 'attached' });
  const colours = await page.evaluate(() => {
    document.body.classList.add('theme-light');
    const after = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el, '::after').backgroundColor : null;
    };
    const sep = document.querySelector('#toolbar .tb-group-separator');
    return {
      frameTitle: after('#toolbar .tb-frame-title'),
      group: after('#toolbar .tb-group'),
      separator: sep ? getComputedStyle(sep).backgroundColor : null,
    };
  });
  expect(colours.frameTitle).toBe(colours.separator);
  expect(colours.group).toBe(colours.separator);
});
