// @ts-check
// The cumulative-time kite points AT the waypoint it counts to, so dragging it towards that
// waypoint buries its tip in the circle — and then neither the time nor the point's name can
// be read. The default position has cleared the disc for a while; a DRAGGED one did not,
// which is what the reported screenshot showed. The tip may reach the edge and no further.
const { test, expect } = require('./_setup');

async function boot(page, wpSize) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' &&
    typeof setCumLabelFromPoint === 'function' && typeof cumKiteMinAnchorDistPx === 'function');
  await page.evaluate((size) => {
    state.waypoints = [
      { lat: 32.00, lng: 34.80, name: 'ALPHA' },
      { lat: 32.20, lng: 34.90, name: 'BASAN' },
    ];
    syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 90; });
    window.showCumTime = true;
    if (size) window.wpSize = size;
    map.setView([32.10, 34.85], 11);
    draw();
  }, wpSize || null);
}

// Drag the kite to a point and report how far its tip ends up from the waypoint centre.
const dragTo = (page, dxFromWp, dyFromWp) => page.evaluate(([dx, dy]) => {
  const b = state.waypoints[1];
  const s = map.latLngToContainerPoint([b.lat, b.lng]);
  setCumLabelFromPoint(0, false, s.x + dx, s.y + dy);
  draw();
  // Where the anchor actually landed, from the leg's own frame.
  const a = map.latLngToContainerPoint([state.waypoints[0].lat, state.waypoints[0].lng]);
  let fx = s.x - a.x, fy = s.y - a.y;
  const len = Math.hypot(fx, fy) || 1;
  fx /= len; fy /= len;
  const sc = legZoomScale() || 1;
  const lab = state.legs[0].cumLabel;
  const px = s.x + fx * (lab.a * sc) + (-fy) * (lab.p * sc);
  const py = s.y + fy * (lab.a * sc) + (fx) * (lab.p * sc);
  const halfLen = (tune('cumKiteCellWidthPx') + tune('cumKiteTriangleLenPx')) * cumKiteDrawScale() / 2;
  return {
    anchorDist: Math.hypot(px - s.x, py - s.y),
    minAllowed: cumKiteMinAnchorDistPx(1),
    discR: waypointGeom(1).r,
    halfLen,
  };
}, [dxFromWp, dyFromWp]);

test('dragged onto the waypoint, the kite stops at the circle edge', async ({ page }) => {
  await boot(page);
  const out = await dragTo(page, 2, 2);                    // dropped right on the point
  expect(out.anchorDist).toBeGreaterThanOrEqual(out.minAllowed - 0.5);
  // The tip -- anchor minus half the kite's length -- is outside the disc, not in it.
  expect(out.anchorDist - out.halfLen).toBeGreaterThanOrEqual(out.discR - 0.5);
});

test('dropped exactly on the centre it still lands clear', async ({ page }) => {
  await boot(page);
  const out = await dragTo(page, 0, 0);
  expect(out.anchorDist).toBeGreaterThanOrEqual(out.minAllowed - 0.5);
});

test('a bigger waypoint pushes it further out', async ({ page }) => {
  await boot(page, 3);
  const out = await dragTo(page, 5, 5);
  expect(out.discR).toBeGreaterThan(30);                   // the slider really did grow it
  expect(out.anchorDist - out.halfLen).toBeGreaterThanOrEqual(out.discR - 0.5);
});

test('a drag that stays clear is left exactly where it was put', async ({ page }) => {
  await boot(page);
  const far = await dragTo(page, 160, 120);
  expect(far.anchorDist).toBeGreaterThan(far.minAllowed);
  const placed = await page.evaluate(() => {
    const b = state.waypoints[1];
    const s = map.latLngToContainerPoint([b.lat, b.lng]);
    setCumLabelFromPoint(0, false, s.x + 160, s.y + 120);
    const lab = state.legs[0].cumLabel;
    return { a: lab.a, p: lab.p };
  });
  // Unclamped: the same drop point round-trips to the same offset.
  const again = await page.evaluate(() => {
    const b = state.waypoints[1];
    const s = map.latLngToContainerPoint([b.lat, b.lng]);
    setCumLabelFromPoint(0, false, s.x + 160, s.y + 120);
    const lab = state.legs[0].cumLabel;
    return { a: lab.a, p: lab.p };
  });
  expect(again).toEqual(placed);
});
