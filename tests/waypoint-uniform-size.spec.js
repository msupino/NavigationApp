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
    syncLegs();
    // Zoom in so the ground-sized disc is large enough that a long label has to
    // shrink below a short one (at a far-out zoom every font floors at 4).
    map.setView([32.30, 35.10], 14);
    draw();
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

test('the waypoint disc is a fixed ground size that prints at the tuned diameter (7 mm)', async ({ page }) => {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' &&
    typeof waypointGeom === 'function' && typeof printPxPerMm === 'function');
  const out = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.10, lng: 34.90, name: 'A' }, { lat: 32.40, lng: 35.10, name: 'B' }];
    syncLegs();
    window.pageOrient = 'landscape';
    if (pageSize !== 'A4') setPage('A4');
    draw();
    // Sizing is geographic (printPxPerMm = 250/metresPerPixel) on screen AND in
    // export, so on-screen size already IS the printed size: mm = px / printPxPerMm.
    const ppm = printPxPerMm();
    const r = waypointGeom(0).r;
    return { diaMm: (2 * r) / ppm, want: tune('waypointPrintDiaMm') };
  });
  expect(out.want).toBe(7);
  expect(out.diaMm).toBeCloseTo(7, 1);
});

test('the leg kite is a fixed ground size that prints at the tuned height (18.5 mm)', async ({ page }) => {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' &&
    typeof drawLegArrow === 'function' && typeof printPxPerMm === 'function' &&
    typeof legZoomScale === 'function');
  const out = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
    syncLegs();
    window.pageOrient = 'landscape';
    if (pageSize !== 'A4') setPage('A4');
    draw();
    const ppm = printPxPerMm();
    const ys = [], p = CanvasRenderingContext2D.prototype;
    const om = p.moveTo, ol = p.lineTo;
    p.moveTo = function (x, y) { ys.push(y); return om.call(this, x, y); };
    p.lineTo = function (x, y) { ys.push(y); return ol.call(this, x, y); };
    drawLegArrow(0, 0, 0, '123', '0:08', '2500', '#000', '#ff0', false, legZoomScale());
    p.moveTo = om; p.lineTo = ol;
    return { heightMm: (Math.max(...ys) - Math.min(...ys)) / ppm, want: tune('kitePrintHeightMm') };
  });
  expect(out.want).toBe(18.5);
  expect(out.heightMm).toBeCloseTo(18.5, 1);
});

test('the cum-time kite is a fixed ground size that prints at the tuned height (9.5 mm)', async ({ page }) => {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' &&
    typeof drawCumTimeArrow === 'function' && typeof printPxPerMm === 'function' &&
    typeof legZoomScale === 'function');
  const out = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
    syncLegs();
    window.pageOrient = 'landscape';
    if (pageSize !== 'A4') setPage('A4');
    draw();
    const ppm = printPxPerMm();
    const ys = [], p = CanvasRenderingContext2D.prototype;
    const om = p.moveTo, ol = p.lineTo;
    p.moveTo = function (x, y) { ys.push(y); return om.call(this, x, y); };
    p.lineTo = function (x, y) { ys.push(y); return ol.call(this, x, y); };
    drawCumTimeArrow(0, 0, 0, '0:08', '#000', '#ff0', legZoomScale());
    p.moveTo = om; p.lineTo = ol;
    return { heightMm: (Math.max(...ys) - Math.min(...ys)) / ppm, want: tune('cumKitePrintHeightMm') };
  });
  expect(out.want).toBe(9.5);
  expect(out.heightMm).toBeCloseTo(9.5, 1);
});
