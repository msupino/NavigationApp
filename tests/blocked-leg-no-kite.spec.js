// @ts-check
// A leg flown in a blocked (one-way) direction has no valid altitude, so its
// nav (direction) kite is not drawn. Also guards the HTZUK→KNTRY dataset row.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof draw === 'function' && typeof syncLegs === 'function' &&
    typeof legAltitudeIsBlocked === 'function');
}

test('a blocked inbound direction draws no nav kite', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 34.8, name: 'A' }, { lat: 32.4, lng: 34.9, name: 'B' }];
    state.legs = []; syncLegs();
    const leg = state.legs[0];
    const orig = window.drawLegArrow;
    // Blocked inbound (one-way reverse): kite must be skipped.
    leg.inboundAltitude = NaN; leg._legAltitudeInboundBlocked = 1; leg._legAltitudeOneWay = 1;
    let blocked = 0; window.drawLegArrow = (...a) => { blocked++; return orig(...a); };
    draw();
    // Unblocked: kite drawn.
    delete leg._legAltitudeInboundBlocked; delete leg._legAltitudeOneWay; leg.inboundAltitude = 1200;
    let open = 0; window.drawLegArrow = (...a) => { open++; return orig(...a); };
    draw();
    window.drawLegArrow = orig;
    return { blocked, open };
  });
  expect(r.blocked).toBe(0);
  expect(r.open).toBeGreaterThan(0);
});

test('a blocked inbound kite is not hit-testable (no invisible clickable kite)', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.2, lng: 35.0, name: 'A' }, { lat: 32.7, lng: 35.0, name: 'B' }];
    state.legs = []; syncLegs();
    const leg = state.legs[0];
    leg.flightSpeed = 90;
    map.setView([32.45, 35.0], 10, { animate: false }); draw();
    const c = legLabelCenter(0, 'in');            // where the inbound kite sits
    const open = !!hitLegLabel(c.x, c.y);          // unblocked → grabbable
    // Block the inbound direction (draw.js skips the kite; hit-test must too).
    leg.inboundAltitude = NaN; leg._legAltitudeInboundBlocked = 1; leg._legAltitudeOneWay = 1;
    draw();
    const blocked = !!hitLegLabel(c.x, c.y);       // must be null → not grabbable
    return { open, blocked };
  });
  expect(r.open).toBe(true);       // an open leg's kite is grabbable
  expect(r.blocked).toBe(false);   // the blocked leg's kite is not
});

test('HTZUK→KNTRY (Country Club) is 1200 one-way; reverse blocked', async ({ page }) => {
  await boot(page);
  const seg = await page.evaluate(async () => {
    const g = await (await fetch('data/cvfr-route-graph.json?cb=' + Date.now(), { cache: 'no-store' })).json();
    return legAltitudeFromGraph(g).segments.find(s => s.from === 'HTZUK' && s.to === 'KNTRY');
  });
  expect(seg.inboundAltitude).toBe(1200);   // HTZUK → Country Club
  expect(seg.outboundAltitude).toBeNull();   // reverse blocked
  expect(seg.oneWay).toBe(true);
});
