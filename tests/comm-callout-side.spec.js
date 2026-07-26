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

test('omitting the index still resolves the side (no caller can regress to static)', async ({ page }) => {
  const r = await page.evaluate(() => {
    // Northbound: left of travel is WEST. A one-argument call must match the
    // two-argument one — several callers (the ↻ reset button, a manually added
    // freq change, reset-all-markers, a shared-link load) pass no index, and used
    // to silently get the static east offset instead.
    state.waypoints = [{ lat: 32.1, lng: 35.0, name: 'S' }, { lat: 32.4, lng: 35.0, name: 'MID' }, { lat: 32.7, lng: 35.0, name: 'N' }];
    state.legs = []; syncLegs();
    const withIdx = commCalloutDefaultTail(state.waypoints[1], 1);
    const noIdx = commCalloutDefaultTail(state.waypoints[1]);
    return { withIdx, noIdx, dLng: noIdx.lng - 35.0 };
  });
  expect(r.dLng).toBeLessThan(0);                    // west = left of travel
  expect(r.noIdx.lat).toBeCloseTo(r.withIdx.lat, 6); // identical to the indexed call
  expect(r.noIdx.lng).toBeCloseTo(r.withIdx.lng, 6);
});

test('a callout placed without an index is still recognised as "at default" on reverse', async ({ page }) => {
  const r = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.7, lng: 35.0, name: 'N' }, { lat: 32.4, lng: 35.0, name: 'MID' }, { lat: 32.1, lng: 35.0, name: 'S' }];
    state.legs = []; syncLegs();
    const def = commCalloutDefaultTail(state.waypoints[1]);       // no index, southbound → east
    state.notes = [{ lat: def.lat, lng: def.lng, text: 'Freq change', color: '#fff6aa', shape: 'rect', cc: 'MID', freqName: 'X', freq: '118.40', freqAuto: true }];
    const before = state.notes[0].lng - 35.0;
    document.getElementById('reverse').click();
    return { before, after: state.notes[0].lng - 35.0 };
  });
  // It must FLIP (treated as a default), not be frozen as user-dragged.
  expect(r.before).toBeGreaterThan(0);
  expect(r.after).toBeLessThan(0);
});

test('a zero offset means zero, not the shipped default', async ({ page }) => {
  const r = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 35.0, name: 'S' }, { lat: 32.4, lng: 35.0, name: 'MID' }, { lat: 32.7, lng: 35.0, name: 'N' }];
    state.legs = []; syncLegs();
    const before = commCalloutDefaultTail(state.waypoints[1], 1);
    NavAid.tuningDefaults.commChangeNoteLngOffset.value = 0;      // pin callouts on the waypoint
    const zero = commCalloutDefaultTail(state.waypoints[1], 1);
    NavAid.tuningDefaults.commChangeNoteLngOffset.value = 0.09;   // restore
    return { movedBefore: Math.abs(before.lng - 35.0), zeroLng: Math.abs(zero.lng - 35.0), zeroLat: Math.abs(zero.lat - 32.4) };
  });
  expect(r.movedBefore).toBeGreaterThan(0.05);   // normally offset
  expect(r.zeroLng).toBeCloseTo(0, 6);           // 0 really means 0 …
  expect(r.zeroLat).toBeCloseTo(0, 6);           // … in both axes (was 0.09 via `|| 0.09`)
});

test('a template callout is seeded left of travel, like every other one', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const res = await fetch('data/route-templates.json?cb=' + Date.now(), { cache: 'no-store' });
    const data = await res.json();
    const list = data.templates || data;
    // Any template whose notes are lean (cc only, no explicit lat/lng).
    const t = list.find(x => (x.notes || []).some(n => n.cc && !Number.isFinite(n.lat)));
    if (!t) return { skipped: true };
    const built = await routeFromTemplate(t, 100);
    const note = built.notes.find(n => n.cc);
    const wp = built.waypoints.find(w =>
      canonicalNavWaypointName(w.name) === canonicalNavWaypointName(note.cc));
    const i = built.waypoints.indexOf(wp);
    const def = commCalloutDefaultTail(wp, i, built.waypoints);
    return { skipped: false, noteLng: note.lng, defLng: def.lng, noteLat: note.lat, defLat: def.lat };
  });
  if (r.skipped) return;
  // Seeded position must equal the shared bearing-derived default, not the old
  // static +0.09 east (which sat on the kite side for a northbound template and
  // was invisible to both the migration and the reverse re-default).
  expect(r.noteLng).toBeCloseTo(r.defLng, 5);
  expect(r.noteLat).toBeCloseTo(r.defLat, 5);
});
