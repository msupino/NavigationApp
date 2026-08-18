// @ts-check
// The cumulative-time kite used to sit on the SAME side of the leg as the nav kite, so the
// two stacked against each other at the waypoint. Its default place is now an ANGLE from
// the nav kite's side (`cumKiteAngleDeg`), turned towards the direction of flight: 180
// (the default) is straight opposite, 0 is back where it was, 90 is ahead along the leg.
// The distance is unchanged at any angle, so the tip clears the waypoint disc from every
// direction — the clamp in cum-kite-clear-of-waypoint.spec.js covers dragged ones.
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
  // Read the defaults straight from the same helpers the draw code uses.
  const drift = legDefaultLabelPerp(len);
  const cumDef = cumDefaultLabelPerp();
  const ang = (tune('cumKiteAngleDeg') || 0) * Math.PI / 180;
  return {
    navPerp: drift,                              // inbound nav kite: +driftPerp
    cumPerp: Math.cos(ang) * cumDef,
    cumAlong: Math.sin(ang) * cumDef,
    frame: { nx, ny },
  };
});

test('180 by default: straight opposite the nav kite', async ({ page }) => {
  await boot(page);
  const s = await sides(page);
  expect(await page.evaluate(() => tune('cumKiteAngleDeg'))).toBe(180);
  expect(Math.sign(s.navPerp)).toBe(1);
  expect(Math.sign(s.cumPerp)).toBe(-1);         // opposite sign = opposite side
  expect(Math.abs(s.cumAlong)).toBeLessThan(0.001);   // ...and nothing along the leg
});

test('0 puts it back on the nav kite side, 90 sends it along the leg', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { setTune('cumKiteAngleDeg', 0); draw(); });
  const same = await sides(page);
  expect(Math.sign(same.cumPerp)).toBe(Math.sign(same.navPerp));
  expect(Math.abs(same.cumAlong)).toBeLessThan(0.001);

  await page.evaluate(() => { setTune('cumKiteAngleDeg', 90); draw(); });
  const ahead = await sides(page);
  expect(Math.abs(ahead.cumPerp)).toBeLessThan(0.001);   // nothing sideways
  expect(ahead.cumAlong).toBeGreaterThan(0);             // ...all of it along the leg
  await page.evaluate(() => setTune('cumKiteAngleDeg', 180));
});

test('the distance is the same at every angle, so the disc is always cleared', async ({ page }) => {
  await boot(page);
  const dists = await page.evaluate(() => {
    const out = [];
    for (const a of [0, 45, 90, 135, 180, 250, 315]) {
      setTune('cumKiteAngleDeg', a);
      const r = cumDefaultLabelPerp();
      const rad = a * Math.PI / 180;
      out.push(Math.hypot(Math.cos(rad) * r, Math.sin(rad) * r));
    }
    setTune('cumKiteAngleDeg', 180);
    return out;
  });
  const first = dists[0];
  for (const d of dists) expect(Math.abs(d - first)).toBeLessThan(0.001);
});

test('the drawn kite really is where the angle says, not just the number', async ({ page }) => {
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
    setTune('cumKiteAngleDeg', 0);
    draw();
    const afterFlip = { a: state.legs[0].cumLabel.a, p: state.legs[0].cumLabel.p };
    setTune('cumKiteAngleDeg', 180);
    return { placed, afterFlip };
  });
  expect(out.afterFlip).toEqual(out.placed);
});


// The frequency callout used to be pinned 90 degrees left of track -- the quarter the
// cumulative kite now occupies -- so it covered the time it was meant to sit beside.
test.describe('the frequency callout has its own angle', () => {
  test('defaults right and behind, clear of the cumulative kite', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => {
      const ang = tune('commCalloutAngleDeg');
      const wp = state.waypoints[1];
      const tail = commCalloutDefaultTail(wp, 1);
      const brg = geo(state.waypoints[0], wp).brg;
      // Bearing from the waypoint to where the callout was placed.
      const out = geo(wp, { lat: tail.lat, lng: tail.lng }).brg;
      // The knob reads + as LEFT of track; a raw compass delta is + clockwise (right),
      // so the measurement is negated to speak the same language as the setting.
      const rel = -(((out - brg + 540) % 360) - 180);
      return { ang, rel };
    });
    expect(out.ang).toBe(-150);
    expect(Math.round(out.rel)).toBe(-150);             // placed where the knob says
  });

  test('the knob moves it', async ({ page }) => {
    await boot(page);
    const rel = await page.evaluate(() => {
      setTune('commCalloutAngleDeg', 90);
      const wp = state.waypoints[1];
      const tail = commCalloutDefaultTail(wp, 1);
      const brg = geo(state.waypoints[0], wp).brg;
      const out = geo(wp, { lat: tail.lat, lng: tail.lng }).brg;
      setTune('commCalloutAngleDeg', -150);
      return -(((out - brg + 540) % 360) - 180);
    });
    expect(Math.round(rel)).toBe(90);                   // back to square left
  });
});
