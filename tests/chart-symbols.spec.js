// @ts-check
// Chart symbols as the CAAI CVFR chart's legend draws them: a civil airfield is its runways
// outlined in blue with the ARP as a ringed cross, a military one a double circle, and a
// reporting point a triangle -- filled when compulsory, open when on request. The own aircraft is a blue silhouette.
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

test('airfields follow the CVFR legend: runway outlines + ARP, double circle when military', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate((src) => {
    const make = new Function('return (' + src + ')')();
    const count = (af) => {
      const { ctx, calls } = make();
      drawAirfieldSymbol(ctx, { x: 50, y: 50 }, 7, af);
      return {
        rings: calls.filter(c => c[0] === 'arc').length,
        runways: calls.filter(c => c[0] === 'rect').length,
      };
    };
    return {
      bare: count({ lat: 32, lng: 34.8 }),
      llbg: count({ lat: 32, lng: 34.88, runways: ['08/26', '12/30', '03/21'] }),
      military: count({ lat: 31.2, lng: 35.0, type: 'military' }),
    };
  }, recorder.toString());
  expect(out.bare).toEqual({ rings: 1, runways: 0 });       // the ARP alone
  expect(out.llbg).toEqual({ rings: 1, runways: 3 });       // three runway outlines + the ARP
  expect(out.military).toEqual({ rings: 3, runways: 0 });   // halo + the two circles of ◎
});

test('a runway outline lies along its designator on a north-up chart', async ({ page }) => {
  await boot(page);
  const deg = await page.evaluate(() => {
    const af = { lat: 32.18, lng: 34.83, runways: ['09/27'] };
    const a = runwayScreenAngles(af, proj(af))[0];
    // Screen angle (x right, y down) to a bearing, folded to 0..180.
    const b = ((a * 180 / Math.PI + 90) % 180 + 180) % 180;
    return { b, mag: fromMagnetic(90) % 180 };
  });
  expect(Math.abs(deg.b - deg.mag)).toBeLessThan(2);
});

test('the eight air force bases are typed military in the dataset and the loader', async ({ page }) => {
  await boot(page);
  const mil = await page.evaluate(async () => {
    await loadAirfields();
    return airfields.filter(a => a.type === 'military').map(a => a.name).sort();
  });
  expect(mil).toEqual(['LLEK', 'LLHB', 'LLHS', 'LLNV', 'LLOV', 'LLPL', 'LLRD', 'LLRM']);
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
      military: px('canvas.legend-airfield-military'),
      compulsory: px('canvas.legend-report-compulsory'),
      onRequest: px('canvas.legend-waypoint'),
    };
  });
  expect(out.airfield).toBeGreaterThan(20);
  expect(out.military).toBeGreaterThan(20);
  expect(out.compulsory).toBeGreaterThan(20);
  expect(out.onRequest).toBeGreaterThan(20);
});
