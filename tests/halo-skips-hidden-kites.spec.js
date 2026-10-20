// @ts-check
// The altitude/speed-change highlight compares a kite with the nearest kite actually drawn.
// Reported: on a route out of LLMG the first leg (inside the CTR, no kite) left AFULA -> TAVOR,
// the first kite on the chart, outlined as an altitude change -- a change from nothing shown.
const { test, expect } = require('./_setup');

test('the first drawn kite is never an altitude change; later changes still are', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof needsHalo === 'function' && typeof syncLegs === 'function');
  const r = await page.evaluate(() => {
    window.highlightDiff = true;
    state.waypoints = [
      { lat: 32.60, lng: 35.23, name: 'A' }, { lat: 32.61, lng: 35.29, name: 'B' },
      { lat: 32.69, lng: 35.39, name: 'C' }, { lat: 32.83, lng: 35.52, name: 'D' },
      { lat: 32.95, lng: 35.60, name: 'E' },
    ];
    state.legs = []; syncLegs();
    const alts = [1500, 2500, 2500, 3000];
    state.legs.forEach((l, i) => { l.inboundAltitude = alts[i]; l.outboundAltitude = alts[i]; l.flightSpeed = 90; l.outboundSpeed = 90; });
    state.legs[0].hideKite = 1;                 // the departure leg's kite is not drawn
    const out = state.legs.map((_, i) => needsHalo(i, 'in'));
    // The way back reads from the far end: hide the last leg's kite and the one before it
    // has nothing drawn after it to differ from.
    state.legs[0].hideKite = 0; state.legs[3].hideKite = 1;
    const back = state.legs.map((_, i) => needsHalo(i, 'out'));
    return { out, back };
  });
  // leg 1 (2500) differs only from the hidden 1500 leg: not a change. leg 3 (3000) is.
  expect(r.out).toEqual([false, false, false, true]);
  // Way back: leg 2 (2500) is followed only by the hidden 3000 leg: not a change; leg 0 (1500)
  // differs from leg 1 (2500): a change.
  expect(r.back).toEqual([true, false, false, false]);
});
