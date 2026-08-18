// @ts-check
// The cumulative-time kite used to sit on the SAME side of the leg as the nav kite, so the
// two stacked against each other at the waypoint and the eye had to separate them. It now
// takes the opposite side by default — the way the frequency callout already does —
// and `cumKiteOppositeNav` puts it back for anyone who preferred the old arrangement.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof legZoomScale === 'function');
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.80, name: 'ALPHA' },
      { lat: 32.20, lng: 34.80, name: 'BRAVO' },     // due north: an easy frame to reason in
    ];
    syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 90; l.inboundAltitude = 2000; });
    window.showCumTime = true;
    map.setView([32.10, 34.80], 11);
    draw();
  });
}

// Which side of the leg each kite is drawn on: +1 right of travel, -1 left.
const sides = (page) => page.evaluate(() => {
  const a = map.latLngToContainerPoint([state.waypoints[0].lat, state.waypoints[0].lng]);
  const b = map.latLngToContainerPoint([state.waypoints[1].lat, state.waypoints[1].lng]);
  let dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const nx = -dy, ny = dx;                       // the leg frame the drawing code uses
  const sc = legZoomScale() || 1;
  const perpOf = (label, anchor, def) => {
    const p = label && !label._default ? (label.p || 0) * sc : null;
    return p !== null ? p : def;
  };
  // Read the defaults straight from the same helpers the draw code uses.
  const drift = legDefaultLabelPerp(len);
  const cumDef = cumDefaultLabelPerp();
  const oppositeOn = tune('cumKiteOppositeNav') !== false;
  return {
    navPerp: drift,                              // inbound nav kite: +driftPerp
    cumPerp: (oppositeOn ? -1 : 1) * cumDef,
    frame: { nx, ny },
  };
});

test('by default the cumulative kite is opposite the nav kite', async ({ page }) => {
  await boot(page);
  const s = await sides(page);
  expect(Math.sign(s.navPerp)).toBe(1);
  expect(Math.sign(s.cumPerp)).toBe(-1);         // opposite sign = opposite side
});

test('the tunable puts it back on the nav kite side', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { setTune('cumKiteOppositeNav', false); draw(); });
  const s = await sides(page);
  expect(Math.sign(s.cumPerp)).toBe(Math.sign(s.navPerp));
  await page.evaluate(() => setTune('cumKiteOppositeNav', true));
});

test('the drawn kite really is on that side, not just the number', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    // Capture where the cum kite is actually painted.
    let painted = null;
    const orig = window.drawCumTimeArrow;
    window.drawCumTimeArrow = (x, y, ...rest) => { painted = { x, y }; return orig.call(null, x, y, ...rest); };
    draw();
    window.drawCumTimeArrow = orig;
    const b = map.latLngToContainerPoint([state.waypoints[1].lat, state.waypoints[1].lng]);
    // Northbound leg on screen: right of travel is +x. The nav kite is right, so the cum
    // kite must be to the LEFT of the waypoint.
    return { dxFromWaypoint: painted ? painted.x - b.x : null };
  });
  expect(out.dxFromWaypoint).not.toBeNull();
  expect(out.dxFromWaypoint).toBeLessThan(0);
});

test('a dragged kite is untouched by the setting', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const b = map.latLngToContainerPoint([state.waypoints[1].lat, state.waypoints[1].lng]);
    setCumLabelFromPoint(0, false, b.x + 140, b.y + 90);      // placed by hand, well clear
    const placed = { a: state.legs[0].cumLabel.a, p: state.legs[0].cumLabel.p };
    setTune('cumKiteOppositeNav', false);
    draw();
    const afterFlip = { a: state.legs[0].cumLabel.a, p: state.legs[0].cumLabel.p };
    setTune('cumKiteOppositeNav', true);
    return { placed, afterFlip };
  });
  expect(out.afterFlip).toEqual(out.placed);
});
