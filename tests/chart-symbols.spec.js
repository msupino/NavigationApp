// @ts-check
// ICAO chart symbols (Annex 4 VFR chart): an aerodrome is a circle -- runway bars across it
// where the data lists runways -- and a reporting point is a triangle, filled when the report
// is compulsory and open when it is on request. The own aircraft is a blue silhouette.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof drawAirfieldSymbol === 'function' && typeof map !== 'undefined');
}

// Records the canvas calls a painter makes, without depending on pixels.
function recorder() {
  const calls = [];
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      return (...a) => { calls.push([k, ...a]); };
    },
    set(t, k, v) { t[k] = v; calls.push(['set:' + String(k), v]); return true; },
  });
  return { ctx, calls };
}

test('runway designators become bar directions', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => [
    runwayBearingsDeg({ runways: ['08/26', '12/30', '03/21'] }),
    runwayBearingsDeg({ runways: ['09L/27R'] }),
    runwayBearingsDeg({ runways: ['junk', '40/22'] }),
    runwayBearingsDeg({}),
  ]);
  expect(out).toEqual([[80, 120, 30], [90], [], []]);
});

test('an airfield is a circle: a centre dot without runway data, one bar per runway with it', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate((src) => {
    const make = new Function('return (' + src + ')')();
    const count = (af) => {
      const { ctx, calls } = make();
      drawAirfieldSymbol(ctx, { x: 50, y: 50 }, 7, af);
      return {
        arcs: calls.filter(c => c[0] === 'arc').length,
        bars: calls.filter(c => c[0] === 'lineTo').length,
        triangles: calls.filter(c => c[0] === 'closePath').length,
      };
    };
    return {
      bare: count({ lat: 32, lng: 34.8 }),
      llbg: count({ lat: 32, lng: 34.88, runways: ['08/26', '12/30', '03/21'] }),
    };
  }, recorder.toString());
  expect(out.bare).toEqual({ arcs: 2, bars: 0, triangles: 0 });     // ring + centre dot
  expect(out.llbg).toEqual({ arcs: 1, bars: 3, triangles: 0 });     // ring + three runways
});

test('a runway bar lies along its designator on a north-up chart', async ({ page }) => {
  await boot(page);
  const deg = await page.evaluate((src) => {
    const make = new Function('return (' + src + ')')();
    const { ctx, calls } = make();
    const af = { lat: 32.18, lng: 34.83, runways: ['09/27'] };
    const s = proj(af);
    drawAirfieldSymbol(ctx, s, 7, af);
    const from = calls.find(c => c[0] === 'moveTo');
    const to = calls.find(c => c[0] === 'lineTo');
    // Screen bearing of the bar, folded to 0..180.
    const b = (Math.atan2(to[1] - from[1], -(to[2] - from[2])) * 180 / Math.PI + 360) % 180;
    return { b, mag: fromMagnetic(90) % 180 };
  }, recorder.toString());
  expect(Math.abs(deg.b - deg.mag)).toBeLessThan(2);
});

test('reporting points: filled triangle when compulsory, open when on request', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate((src) => {
    const make = new Function('return (' + src + ')')();
    const fillOf = (compulsory) => {
      const { ctx, calls } = make();
      drawReportingPointSymbol(ctx, 10, 10, 6, compulsory);
      return {
        fill: calls.filter(c => c[0] === 'set:fillStyle').map(c => c[1]).pop(),
        corners: calls.filter(c => c[0] === 'lineTo').length,
      };
    };
    return { comp: fillOf(true), req: fillOf(false), ink: tune('inkColor'), open: tune('navWaypointDotColor') };
  }, recorder.toString());
  expect(out.comp).toEqual({ fill: out.ink, corners: 2 });
  expect(out.req).toEqual({ fill: out.open, corners: 2 });
});

test('the nav-waypoint layer draws each point with its own report class', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const seen = [];
    const orig = window.drawReportingPointSymbol;
    const oldNav = navWP, oldShow = showNavWP;
    navWP = [
      { name: 'AAAAA', lat: 32.0, lng: 34.8, report: 'mandatory' },
      { name: 'BBBBB', lat: 32.1, lng: 34.9, report: 'onRequest' },
      { name: 'CCCCC', lat: 32.2, lng: 35.0, report: '' },
    ];
    showNavWP = true;
    // eslint-disable-next-line no-global-assign
    drawReportingPointSymbol = (ctx, x, y, r, compulsory) => seen.push(compulsory);
    try { drawNavWaypoints(); } finally {
      drawReportingPointSymbol = orig; navWP = oldNav; showNavWP = oldShow;
    }
    return seen;
  });
  expect(out).toEqual([true, false, false]);
});

test('the own aircraft is filled with the live-aircraft colour and outlined with its halo', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const fills = [], strokes = [];
    const f = octx.fill, s = octx.stroke;
    octx.fill = function (...a) { fills.push(String(this.fillStyle)); return f.apply(this, a); };
    octx.stroke = function (...a) { strokes.push(String(this.strokeStyle)); return s.apply(this, a); };
    try {
      drawOwnShip({ lat: 32, lng: 34.9, t: Date.now() }, 45, 90);
    } finally { octx.fill = f; octx.stroke = s; }
    return { fills, strokes, color: tune('ownShipColor'), halo: tune('ownShipHaloColor') };
  });
  expect(out.fills).toContain(out.color);
  expect(out.strokes).toContain(out.halo);
});

test('the legend swatches are painted by the map symbol functions', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const px = (sel) => {
      const cv = document.querySelector(sel);
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    };
    return {
      airfield: px('canvas.legend-airfield'),
      compulsory: px('canvas.legend-report-compulsory'),
      onRequest: px('canvas.legend-waypoint'),
    };
  });
  expect(out.airfield).toBeGreaterThan(20);
  expect(out.compulsory).toBeGreaterThan(20);
  expect(out.onRequest).toBeGreaterThan(20);
});
