// @ts-check
// The freq-change callout's default position sits on the LEFT of the direction
// of travel — the opposite side from the nav kites (which sit on the right) —
// so it flips with route direction instead of being a static compass offset.
const { test, expect } = require('./_setup');

test.beforeEach(async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof commCalloutDefaultTail === 'function' && typeof syncLegs === 'function');
});

test('callout default flips side with route direction (opposite the nav kites)', async ({ page }) => {
  const r = await page.evaluate(() => {
    // Southbound through the middle point (prev north, next south).
    state.waypoints = [{ lat: 32.7, lng: 35.0, name: 'N' }, { lat: 32.4, lng: 35.0, name: 'MID' }, { lat: 32.1, lng: 35.0, name: 'S' }];
    state.legs = []; syncLegs();
    const south = commCalloutDefaultTail(state.waypoints[1], 1);
    // Northbound (reverse the order).
    state.waypoints = [{ lat: 32.1, lng: 35.0, name: 'S' }, { lat: 32.4, lng: 35.0, name: 'MID' }, { lat: 32.7, lng: 35.0, name: 'N' }];
    syncLegs();
    const north = commCalloutDefaultTail(state.waypoints[1], 1);
    return { southDLng: south.lng - 35.0, northDLng: north.lng - 35.0 };
  });
  // Southbound: left of travel = east (+lng). Northbound: left = west (-lng).
  expect(r.southDLng).toBeGreaterThan(0);
  expect(r.northDLng).toBeLessThan(0);
  // And they are genuine mirror images, not a static offset.
  expect(r.southDLng).toBeCloseTo(-r.northDLng, 6);
});

test('reversing the route flips a default callout to the far side of the kites', async ({ page }) => {
  const r = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.7, lng: 35.0, name: 'N' }, { lat: 32.4, lng: 35.0, name: 'MID' }, { lat: 32.1, lng: 35.0, name: 'S' }];
    state.legs = []; syncLegs();
    const def = commCalloutDefaultTail(state.waypoints[1], 1);   // southbound → east
    state.notes = [{ lat: def.lat, lng: def.lng, text: 'Freq change', color: '#fff6aa', shape: 'rect', cc: 'MID', freqName: 'X', freq: '118.40', freqAuto: true }];
    const before = state.notes[0].lng - 35.0;
    document.getElementById('reverse').click();                  // northbound → west
    const after = state.notes[0].lng - 35.0;
    return { before, after };
  });
  expect(r.before).toBeGreaterThan(0);
  expect(r.after).toBeLessThan(0);
});

test('reversing leaves a user-dragged callout where it is', async ({ page }) => {
  const r = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.7, lng: 35.0, name: 'N' }, { lat: 32.4, lng: 35.0, name: 'MID' }, { lat: 32.1, lng: 35.0, name: 'S' }];
    state.legs = []; syncLegs();
    state.notes = [{ lat: 32.42, lng: 35.25, text: 'Freq change', color: '#fff6aa', shape: 'rect', cc: 'MID', freqName: 'X', freq: '118.40', freqAuto: true }];
    document.getElementById('reverse').click();
    return { lat: state.notes[0].lat, lng: state.notes[0].lng };
  });
  expect(r.lat).toBeCloseTo(32.42, 5);
  expect(r.lng).toBeCloseTo(35.25, 5);
});

test('a lone point (no adjacent leg) falls back to the plain tune offset', async ({ page }) => {
  const dLng = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.4, lng: 35.0, name: 'MID' }];   // lone point, no leg
    state.legs = []; syncLegs();
    const t = commCalloutDefaultTail(state.waypoints[0], 0);
    return t.lng - 35.0;
  });
  // No direction of travel → the plain commChangeNoteLngOffset (code default
  // +0.09 east; a gist may override the magnitude/sign).
  expect(Math.abs(dLng)).toBeGreaterThan(0.05);
});
