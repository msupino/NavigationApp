// @ts-check
// A hand-edited leg altitude must not carry the old leg's in/out onto a leg
// whose endpoints changed (e.g. a waypoint dragged/snapped to another point).
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof syncLegs === 'function' && typeof markLegAltitudeManual === 'function' &&
    typeof applyLegAltitudesToRoute === 'function');
}

test('moving a waypoint clears a manual leg altitude (re-derives, not stale)', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.10, lng: 34.80, name: 'A' },
      { lat: 32.40, lng: 35.00, name: 'B' },
    ];
    syncLegs();
    // Hand-set leg 0's altitudes (manual).
    state.legs[0].inboundAltitude = 3500;
    state.legs[0].outboundAltitude = 4500;
    markLegAltitudeManual(0);
    const beforeAuto = !!state.legs[0]._legAltitudeAuto;
    // Move waypoint A elsewhere (different point) and re-apply.
    state.waypoints[0].lat = 31.50; state.waypoints[0].lng = 34.60; state.waypoints[0].name = '';
    applyLegAltitudesToRoute();
    return {
      beforeAuto,
      inbound: state.legs[0].inboundAltitude,
      outbound: state.legs[0].outboundAltitude,
      autoAfter: !!state.legs[0]._legAltitudeAuto,
    };
  });
  expect(result.beforeAuto).toBe(false);          // was manual
  // Endpoints changed → no dataset match → cleared, not the old 3500/4500.
  expect(result.inbound).not.toBe(3500);
  expect(result.outbound).not.toBe(4500);
  expect(result.autoAfter).toBe(true);            // reverted to auto
});

test('a manual leg altitude survives when its endpoints are unchanged', async ({ page }) => {
  await boot(page);
  const kept = await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.10, lng: 34.80, name: 'A' },
      { lat: 32.40, lng: 35.00, name: 'B' },
    ];
    syncLegs();
    state.legs[0].inboundAltitude = 3500;
    markLegAltitudeManual(0);
    applyLegAltitudesToRoute();   // no move
    return state.legs[0].inboundAltitude;
  });
  expect(kept).toBe(3500);
});
