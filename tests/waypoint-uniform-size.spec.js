// @ts-check
// Waypoint circles are all one size (radius from wpSize x zoom, never the
// label); the text shrinks to fit instead of the circle growing.
const { test, expect } = require('./_setup');

test('all waypoint circles share one radius; long labels shrink the font', async ({ page }) => {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && typeof waypointGeom === 'function');
  const g = await page.evaluate(() => {
    showWpNames = true;
    state.waypoints = [
      { lat: 32.10, lng: 34.90, name: 'A' },
      { lat: 32.30, lng: 35.10, name: 'LONGWAYPOINT' },
      { lat: 32.50, lng: 35.30, name: 'MID12' },
    ];
    syncLegs(); draw();
    const a = waypointGeom(0), b = waypointGeom(1), c = waypointGeom(2);
    return { ra: a.r, rb: b.r, rc: c.r, fa: a.fontPx, fb: b.fontPx, fc: c.fontPx };
  });
  // identical radius regardless of label length
  expect(g.rb).toBeCloseTo(g.ra, 5);
  expect(g.rc).toBeCloseTo(g.ra, 5);
  // long label shrinks the font below the short one; never below the floor
  expect(g.fb).toBeLessThan(g.fa);
  expect(g.fb).toBeGreaterThanOrEqual(4);
});

test('framed A4 export sizes the waypoint disc to the tuned physical diameter (7 mm)', async ({ page }) => {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' &&
    typeof waypointGeom === 'function' && typeof pageFrameRect === 'function');
  const out = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.10, lng: 34.90, name: 'A' }, { lat: 32.40, lng: 35.10, name: 'B' }];
    syncLegs();
    window.pageOrient = 'landscape';
    if (pageSize !== 'A4') setPage('A4');
    draw();
    const fr = pageFrameRect();
    // On screen (no export override): the zoom/wpSize formula, not the print size.
    NavAid._exportPxPerMm = 0;
    const screenR = waypointGeom(0).r;
    // Export pins the disc: draw() runs in screen coords, then scales by W/fr.w
    // and prints at W/paperW px per mm, so printed mm = r_screen * paperW / fr.w.
    const paperW = 297;                       // A4 landscape width in mm
    const diaMm = tune('waypointPrintDiaMm');
    NavAid._exportPxPerMm = fr.w / paperW;    // screen px per paper mm
    const exportR = waypointGeom(0).r;
    NavAid._exportPxPerMm = 0;
    return { diaMm, screenR, exportR, printedMm: exportR * paperW / fr.w * 2,
             expectScreenR: tune('waypointBaseRadiusPx') *
               Math.max(tune('waypointMinZoomScale'), Math.pow(2, map.getZoom() - 12)) };
  });
  expect(out.diaMm).toBe(7);
  expect(out.printedMm).toBeCloseTo(7, 2);              // exactly 7 mm on paper
  expect(out.screenR).toBeCloseTo(out.expectScreenR, 5); // screen size unchanged
  expect(out.exportR).not.toBeCloseTo(out.screenR, 1);   // export overrode the screen radius
});

test('framed A4 export sizes the leg kite to its tuned physical size (21 body + 10 triangle × 18.5 mm)', async ({ page }) => {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' &&
    typeof drawLegArrow === 'function' && typeof pageFrameRect === 'function' &&
    typeof legZoomScale === 'function');
  const out = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
    syncLegs();
    window.pageOrient = 'landscape';
    if (pageSize !== 'A4') setPage('A4');
    draw();
    const fr = pageFrameRect(), paperW = 297, ppm = fr.w / paperW;
    // Capture the kite path extents drawn by drawLegArrow.
    const measure = () => {
      const xs = [], ys = [], p = CanvasRenderingContext2D.prototype;
      const om = p.moveTo, ol = p.lineTo;
      p.moveTo = function (x, y) { xs.push(x); ys.push(y); return om.call(this, x, y); };
      p.lineTo = function (x, y) { xs.push(x); ys.push(y); return ol.call(this, x, y); };
      drawLegArrow(0, 0, 0, '123', '0:08', '2500', '#000', '#ff0', false, legZoomScale());
      p.moveTo = om; p.lineTo = ol;
      return { L: Math.max(...xs) - Math.min(...xs), W: Math.max(...ys) - Math.min(...ys) };
    };
    NavAid._exportPxPerMm = ppm;
    const m = measure();
    NavAid._exportPxPerMm = 0;
    return {
      totalLenMm: m.L / ppm, heightMm: m.W / ppm,
      wantLen: tune('kitePrintLengthMm') + tune('kitePrintTriangleMm'),
      wantHeight: tune('kitePrintHeightMm'),
    };
  });
  expect(out.wantLen).toBe(31);              // 21 body + 10 triangle
  expect(out.wantHeight).toBe(18.5);         // triangle sits on the short side
  expect(out.totalLenMm).toBeCloseTo(31, 1);
  expect(out.heightMm).toBeCloseTo(18.5, 1);
});

test('framed A4 export sizes the cumulative-time kite to 9.5 body + 9.5 triangle × 6 mm', async ({ page }) => {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' &&
    typeof drawCumTimeArrow === 'function' && typeof pageFrameRect === 'function' &&
    typeof legZoomScale === 'function');
  const out = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
    syncLegs();
    window.pageOrient = 'landscape';
    if (pageSize !== 'A4') setPage('A4');
    draw();
    const fr = pageFrameRect(), paperW = 297, ppm = fr.w / paperW;
    const xs = [], ys = [], p = CanvasRenderingContext2D.prototype;
    const om = p.moveTo, ol = p.lineTo;
    p.moveTo = function (x, y) { xs.push(x); ys.push(y); return om.call(this, x, y); };
    p.lineTo = function (x, y) { xs.push(x); ys.push(y); return ol.call(this, x, y); };
    NavAid._exportPxPerMm = ppm;
    drawCumTimeArrow(0, 0, 0, '0:08', '#000', '#ff0', legZoomScale());
    NavAid._exportPxPerMm = 0;
    p.moveTo = om; p.lineTo = ol;
    return {
      totalLenMm: (Math.max(...xs) - Math.min(...xs)) / ppm,
      heightMm: (Math.max(...ys) - Math.min(...ys)) / ppm,
      wantLen: tune('cumKitePrintLengthMm') + tune('cumKitePrintTriangleMm'),
      wantHeight: tune('cumKitePrintHeightMm'),
    };
  });
  expect(out.wantLen).toBe(19);              // 9.5 body + 9.5 triangle
  expect(out.wantHeight).toBe(6);
  expect(out.totalLenMm).toBeCloseTo(19, 1);
  expect(out.heightMm).toBeCloseTo(6, 1);
});
