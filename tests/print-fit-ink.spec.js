// @ts-check
// The print-clipping warning has to consider everything the export DRAWS, not just the
// waypoint coordinates. A leg kite is ~18.5 x 33 mm of ink hanging off its leg, so a
// route whose waypoints all sit inside the page frame can still print with its labels
// sliced off the edge — and the first version of this check passed it silently.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof routePageFit === 'function' &&
    typeof routeInkRects === 'function');
}

async function twoLegRoute(page) {
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.10, lng: 34.86, name: 'A' }, { lat: 32.30, lng: 34.90, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 110; l.inboundAltitude = 2000; });
    window.showCumTime = true;
    map.setView([32.2, 34.88], 11, { animate: false });
    setPage('A4'); pageOrient = 'landscape'; pageOffset = { x: 0, y: 0 };
    draw();
  });
}

// Slide the frame so every waypoint is still inside but the outermost ink is cut.
async function clipTheInkOnly(page) {
  return page.evaluate(() => {
    const fr = pageFrameRect();
    const ink = routeInkRects();
    const wpMaxX = Math.max(...state.waypoints.map(w => proj(w).x));
    const inkMaxX = Math.max(...ink.map(i => i.x + i.w));
    const wantRight = wpMaxX + (inkMaxX - wpMaxX) * 0.3;
    pageOffset = { x: pageOffset.x + (wantRight - (fr.x + fr.w)), y: 0 };
    draw();
    const f = pageFrameRect();
    return state.waypoints.every(w => { const p = proj(w);
      return p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h; });
  });
}

test('ink rectangles cover kites and cumulative kites, not just waypoints', async ({ page }) => {
  await boot(page);
  await twoLegRoute(page);
  const r = await page.evaluate(() => {
    const withCum = routeInkRects().length;
    window.showCumTime = false; draw();
    const withoutCum = routeInkRects().length;
    window.showCumTime = true; draw();
    return { withCum, withoutCum, waypoints: state.waypoints.length };
  });
  // 2 waypoints + 1 leg kite + 1 cum kite = 4; dropping the cum kite drops one rect.
  expect(r.withCum).toBeGreaterThan(r.waypoints);
  expect(r.withoutCum).toBe(r.withCum - 1);
});

test('a clipped kite triggers the warning even when every waypoint is inside', async ({ page }) => {
  await boot(page);
  await twoLegRoute(page);
  const centred = await page.evaluate(() => routePageFit());
  expect(centred.fits).toBe(true);
  const wpsStillInside = await clipTheInkOnly(page);
  expect(wpsStillInside).toBe(true);                 // the old check would have passed here
  const r = await page.evaluate(() => ({ fit: routePageFit(),
    warn: !document.getElementById('print-clip-warn').hidden,
    fitBtn: !document.getElementById('print-fit').hidden }));
  expect(r.fit.fits).toBe(false);
  expect(r.fit.inside).toBeLessThan(r.fit.total);
  expect(r.warn).toBe(true);
  expect(r.fitBtn).toBe(true);
});

test('Fit page to route fits the ink, not just the coordinates', async ({ page }) => {
  await boot(page);
  await twoLegRoute(page);
  await clipTheInkOnly(page);
  const after = await page.evaluate(() => {
    document.getElementById('print-fit').click();
    draw();
    return { fit: routePageFit(), warn: !document.getElementById('print-clip-warn').hidden };
  });
  expect(after.fit.fits).toBe(true);
  expect(after.warn).toBe(false);
});

test('notes and comm callouts count as ink', async ({ page }) => {
  await boot(page);
  await twoLegRoute(page);
  const r = await page.evaluate(() => {
    const before = routeInkRects().length;
    state.notes = [{ lat: 32.22, lng: 34.93, text: 'HOLD HERE' }];
    draw();
    return { before, after: routeInkRects().length };
  });
  expect(r.after).toBe(r.before + 1);
});

test('the flight-plan card counts as ink', async ({ page }) => {
  await boot(page);
  await twoLegRoute(page);
  const r = await page.evaluate(() => {
    const before = routeInkRects().length;
    // Place the card the way the export modal does, then let draw() measure it.
    const fr = pageFrameRect();
    window.planCard = { x: fr.x + 14, y: fr.y + 14, scale: 1 };
    draw();
    const after = routeInkRects().length;
    window.planCard = null; draw();
    return { before, after, hadRect: after > before };
  });
  expect(r.hadRect).toBe(true);
});

test('an empty route still reports a fit', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.waypoints = []; state.legs = []; state.notes = []; syncLegs(); draw();
    return { fit: routePageFit(), rects: routeInkRects().length };
  });
  expect(r.fit.fits).toBe(true);
  expect(r.rects).toBe(0);
});
