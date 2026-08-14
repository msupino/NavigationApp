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
    setTune('pageFrameLocked', false);
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
    fitBtn: !document.getElementById('print-fit').hidden,
    fitDisabled: document.getElementById('print-fit').disabled }));
  expect(r.fit.fits).toBe(false);
  expect(r.fit.inside).toBeLessThan(r.fit.total);
  expect(r.warn).toBe(true);
  expect(r.fitBtn).toBe(true);
  expect(r.fitDisabled).toBe(false);
});

test('Fit page to route fits the ink, not just the coordinates', async ({ page }) => {
  await boot(page);
  await twoLegRoute(page);
  await clipTheInkOnly(page);
  const after = await page.evaluate(() => {
    document.getElementById('print-fit').click();
    draw();
    return { fit: routePageFit(), warn: !document.getElementById('print-clip-warn').hidden,
      fitVisible: !document.getElementById('print-fit').hidden,
      fitDisabled: document.getElementById('print-fit').disabled };
  });
  expect(after.fit.fits).toBe(true);
  expect(after.warn).toBe(false);
  expect(after.fitVisible).toBe(true);
  expect(after.fitDisabled).toBe(true);
});

test('locked Fit preview is inert, while applying Fit pans the map under the frame', async ({ page }) => {
  await boot(page);
  await twoLegRoute(page);
  const before = await page.evaluate(() => {
    setTune('pageFrameLocked', true);
    map.panBy([420, 0], { animate: false });
    draw();
    const c = map.getCenter();
    return {
      fits: routePageFit().fits,
      center: { lat: c.lat, lng: c.lng },
      enabled: !document.getElementById('print-fit').disabled,
    };
  });
  expect(before.fits).toBe(false);
  expect(before.enabled).toBe(true);

  // Re-running the availability preview must not move the map.
  const preview = await page.evaluate(() => {
    refreshPrintFit();
    const c = map.getCenter();
    return { lat: c.lat, lng: c.lng };
  });
  expect(preview.lat).toBeCloseTo(before.center.lat, 8);
  expect(preview.lng).toBeCloseTo(before.center.lng, 8);

  const after = await page.evaluate(() => {
    document.getElementById('print-fit').click();
    draw();
    const c = map.getCenter(), r = pageFrameRect();
    return {
      fits: routePageFit().fits,
      center: { lat: c.lat, lng: c.lng },
      frameCentre: { x: r.x + r.w / 2, y: r.y + r.h / 2 },
      viewport: { x: vw() / 2, y: vh() / 2 },
    };
  });
  expect(after.fits).toBe(true);
  expect(Math.abs(after.center.lat - before.center.lat) +
    Math.abs(after.center.lng - before.center.lng)).toBeGreaterThan(0.001);
  expect(after.frameCentre.x).toBeCloseTo(after.viewport.x, 5);
  expect(after.frameCentre.y).toBeCloseTo(after.viewport.y, 5);
});

test('Fit page to route stays visible but dimmed when the page already fits', async ({ page }) => {
  await boot(page);
  await twoLegRoute(page);
  const state = await page.evaluate(() => {
    const button = document.getElementById('print-fit');
    return { visible: !button.hidden, disabled: button.disabled, fits: routePageFit().fits,
      opacity: parseFloat(getComputedStyle(button).opacity) };
  });
  expect(state.fits).toBe(true);
  expect(state.visible).toBe(true);
  expect(state.disabled).toBe(true);
  expect(state.opacity).toBeLessThan(1);
});

test('phone RTL Print menu keeps both Fit actions visible without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof setPage === 'function');
  await page.locator('#toolbar-toggle').click();
  await page.locator('.tb-section[data-sec="print"] .tb-section-head').click();
  const layout = await page.evaluate(() => {
    const screen = document.getElementById('print-fit-screen').getBoundingClientRect();
    const route = document.getElementById('print-fit').getBoundingClientRect();
    return {
      dir: document.documentElement.dir,
      screen: { left: screen.left, right: screen.right, width: screen.width },
      route: { left: route.left, right: route.right, width: route.width },
      routeVisible: !document.getElementById('print-fit').hidden,
      routeOpacity: parseFloat(getComputedStyle(document.getElementById('print-fit')).opacity),
    };
  });
  expect(layout.dir).toBe('rtl');
  expect(layout.routeVisible).toBe(true);
  expect(layout.routeOpacity).toBeLessThan(1);
  for (const box of [layout.screen, layout.route]) {
    expect(box.width).toBeGreaterThan(0);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(375);
  }
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

test('the message names what is clipped: labels, not the route', async ({ page }) => {
  // The route plainly inside the frame plus a warning saying "the route runs past the
  // page" reads as a warning that failed to clear. Say it is a label.
  await boot(page);
  await twoLegRoute(page);
  await clipTheInkOnly(page);
  const r = await page.evaluate(() => {
    const frame = pageFrameRect();
    return { routeInside: state.waypoints.every(w => { const p = proj(w);
        return p.x >= frame.x && p.x <= frame.x + frame.w &&
               p.y >= frame.y && p.y <= frame.y + frame.h; }),
      text: document.getElementById('print-clip-warn').textContent };
  });
  expect(r.routeInside).toBe(true);
  expect(r.text).toMatch(/label or marker/);
  expect(r.text).not.toMatch(/The route runs past/);
});

test('a genuine route overrun still blames the route', async ({ page }) => {
  await boot(page);
  await twoLegRoute(page);
  const r = await page.evaluate(() => {
    // shove the frame right off the route
    setTune('pageFrameLocked', false);
    pageOffset = { x: 600, y: 0 };
    draw();
    return { fits: routePageFit().fits, text: document.getElementById('print-clip-warn').textContent };
  });
  expect(r.fits).toBe(false);
  expect(r.text).toMatch(/route runs past the page/);
});

test('a route too long for any page keeps its own message', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.waypoints = [{ lat: 31.23, lng: 34.79, name: 'LLBS' }, { lat: 32.99, lng: 35.57, name: 'LLIB' }];
    state.legs = []; syncLegs(); fitView(); setPage('A4'); draw();
    const button = document.getElementById('print-fit');
    return { text: document.getElementById('print-clip-warn').textContent,
      fitBtn: !button.hidden, fitDisabled: button.disabled };
  });
  expect(r.text).toMatch(/No page size/);
  expect(r.fitBtn).toBe(true);
  expect(r.fitDisabled).toBe(true);
});
