// @ts-check
// Reverse rebuilds every leg from an explicit object literal, so any per-leg field not named
// there is silently dropped. Two were: the leg's reference VOR (which decides its published
// Radial/DME) and the hidden-kite flag. Both belong to the physical segment, not to the
// direction it is flown — the same argument the code already makes for the per-leg wind.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + s, '1');
    } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof loadVors === 'function' && typeof legKiteHidden === 'function' &&
    !!document.getElementById('reverse'));
  await page.evaluate(() => loadVors());
}

async function route(page) {
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.10, lng: 34.85, name: 'A' },
      { lat: 32.40, lng: 35.05, name: 'B' },
      { lat: 32.62, lng: 34.95, name: 'C' },
    ];
    syncLegs();
    for (const l of state.legs) { l.flightSpeed = 90; l.inboundAltitude = 2000; }
    draw();
  });
}

test('Reverse keeps each leg\'s reference VOR, on the segment it belongs to', async ({ page }) => {
  await boot(page);
  await route(page);
  const r = await page.evaluate(() => {
    // Leg 0 is A→B, leg 1 is B→C. Give them different references.
    state.legs[0].vorRef = 'BGN';
    state.legs[1].vorRef = 'NAT';
    const before = state.legs.map(l => l.vorRef || null);
    document.getElementById('reverse').click();
    return { before, after: state.legs.map(l => l.vorRef || null),
      names: state.waypoints.map(w => w.name) };
  });
  expect(r.names).toEqual(['C', 'B', 'A']);
  // Reversed, the first leg is C→B — the physical segment that was leg 1 — so it keeps
  // NAT, and the old leg 0's BGN travels to the end. Losing them sent both back to the
  // GLOBAL VOR, silently changing the Radial/DME cells for the same piece of ground.
  expect(r.after).toEqual(['NAT', 'BGN']);
});

test('the reversed leg computes Radial/DME from its own VOR, not the global one', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.10, lng: 34.85, name: 'A' }, { lat: 32.46472, lng: 34.91222, name: 'HADRA' }];
    syncLegs();
    state.legs[0].flightSpeed = 90;
    window.vorRef = 'NAT';            // global reference
    state.legs[0].vorRef = 'BGN';     // this leg overrides it
    draw();
  });
  const r = await page.evaluate(() => {
    document.getElementById('reverse').click();
    const leg = state.legs[0];
    const chosen = (leg.vorRef && vorByIdent(leg.vorRef)) || activeVor();
    const wp = state.waypoints[0];
    const own = vorRadialDme(vorByIdent('BGN'), wp.lat, wp.lng);
    const global = vorRadialDme(vorByIdent('NAT'), wp.lat, wp.lng);
    return { ident: chosen && chosen.ident, sameAsOwn: own && chosen && chosen.ident === 'BGN',
      differs: own && global && own.radial !== global.radial };
  });
  expect(r.ident).toBe('BGN');
  expect(r.sameAsOwn).toBe(true);
  // ...and the two references really do give different numbers, so the assertion above
  // would have caught the fallback rather than passing by coincidence.
  expect(r.differs).toBe(true);
});

test('Reverse keeps a hidden nav kite hidden', async ({ page }) => {
  await boot(page);
  await route(page);
  const r = await page.evaluate(() => {
    state.legs[0].hideKite = 1;       // A→B decluttered
    draw();
    const before = state.legs.map(l => (legKiteHidden(l) ? 1 : 0));
    document.getElementById('reverse').click();
    return { before, after: state.legs.map(l => (legKiteHidden(l) ? 1 : 0)) };
  });
  expect(r.before).toEqual([1, 0]);
  // Reversed, that segment is the LAST leg — the flag rides the segment, and the kite
  // does not silently reappear on a leg the pilot deliberately cleared.
  expect(r.after).toEqual([0, 1]);
});

test('a hidden kite draws no ink for the page-fit calculation', async ({ page }) => {
  await boot(page);
  await route(page);
  const r = await page.evaluate(() => {
    window.showReturn = false;
    draw();
    const count = () => (typeof routeInkRects === 'function' ? routeInkRects().length : -1);
    const before = count();
    state.legs[0].hideKite = 1;
    draw();
    return { before, after: count() };
  });
  // "Fit page to route" and the clipping warning were driven by ink the renderer skips, so
  // an invisible kite could claim the route hangs off the sheet or force a larger page.
  expect(r.before).toBeGreaterThan(0);
  expect(r.after).toBe(r.before - 1);
});

test('the hidden-kite ink gate still applies after a reverse', async ({ page }) => {
  await boot(page);
  await route(page);
  const r = await page.evaluate(() => {
    window.showReturn = false;
    state.legs[0].hideKite = 1;
    draw();
    document.getElementById('reverse').click();
    draw();
    // Compare on the far side of the reverse rather than across it: the reverse also
    // re-applies leg altitudes and redraws, so an absolute count from before it would be
    // asserting unrelated state.
    const hiddenIdx = state.legs.findIndex(l => legKiteHidden(l));
    const withHidden = routeInkRects().length;
    delete state.legs[hiddenIdx].hideKite;
    draw();
    return { hiddenIdx, withHidden, shown: routeInkRects().length };
  });
  expect(r.hiddenIdx).toBeGreaterThanOrEqual(0);      // the flag survived at all
  expect(r.shown).toBe(r.withHidden + 1);             // ...and still suppresses its ink
});
