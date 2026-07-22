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
    NavAid._exportWpRadiusPx = 0;
    const screenR = waypointGeom(0).r;
    // Export pins the disc: draw() runs in screen coords, then scales by W/fr.w
    // and prints at W/paperW px per mm, so printed mm = r_screen * paperW / fr.w.
    const paperW = 297;                       // A4 landscape width in mm
    const diaMm = tune('waypointPrintDiaMm');
    NavAid._exportWpRadiusPx = (diaMm / 2) * fr.w / paperW;
    const exportR = waypointGeom(0).r;
    NavAid._exportWpRadiusPx = 0;
    return { diaMm, screenR, exportR, printedMm: exportR * paperW / fr.w * 2,
             expectScreenR: tune('waypointBaseRadiusPx') *
               Math.max(tune('waypointMinZoomScale'), Math.pow(2, map.getZoom() - 12)) };
  });
  expect(out.diaMm).toBe(7);
  expect(out.printedMm).toBeCloseTo(7, 2);              // exactly 7 mm on paper
  expect(out.screenR).toBeCloseTo(out.expectScreenR, 5); // screen size unchanged
  expect(out.exportR).not.toBeCloseTo(out.screenR, 1);   // export overrode the screen radius
});
