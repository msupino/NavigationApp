// @ts-check
// A leg's NAV KITE — the heading/time/altitude marker — can be hidden from the leg inspector,
// for when a busy area is an unreadable pile of kites. Nothing else changes: the leg line, its
// drift cone, the cumulative-time kite, the distance badge, the minute marks, the wind arrow
// and the flight plan are all untouched. Clicking the line still selects the leg, because leg
// selection never went through a marker — that is what makes hiding reversible.
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
    typeof legKiteHidden === 'function' && typeof showInspector === 'function' &&
    typeof hitLegLabel === 'function');
}

async function route(page) {
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.10, lng: 34.85, name: 'A' },
      { lat: 32.40, lng: 35.05, name: 'B' },
      { lat: 32.62, lng: 34.95, name: 'C' },
    ];
    syncLegs();
    for (const l of state.legs) { l.flightSpeed = 90; l.inboundAltitude = 2000; l.outboundAltitude = 2500; }
    map.fitBounds(state.waypoints.map(w => [w.lat, w.lng]), { padding: [120, 120], animate: false });
    draw();
  });
}

const legButton = (page, re) => page.locator('#insp-body button.insp-btn').filter({ hasText: re });

async function selectLegByClickingItsLine(page, i) {
  return page.evaluate(idx => {
    // Midpoint of the leg, offset nowhere — the line itself.
    const a = proj(state.waypoints[idx]), b = proj(state.waypoints[idx + 1]);
    const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    const hit = hitLeg(x, y);
    // Leg selection happens on mousedown (interact.js), not on Leaflet's synthetic click.
    map.fire('mousedown', { containerPoint: L.point(x, y),
      latlng: map.containerPointToLatLng([x, y]) });
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return { hit, selected: JSON.parse(JSON.stringify(state.selected || null)) };
  }, i);
}

test('the inspector hides the leg kite, and restores it', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => { state.selected = { type: 'leg', index: 0 }; showInspector(); });
  await expect(legButton(page, /Hide kite/)).toBeVisible();
  await legButton(page, /Hide kite/).click();
  expect(await page.evaluate(() => legKiteHidden(state.legs[0]))).toBe(true);
  // Only this leg.
  expect(await page.evaluate(() => legKiteHidden(state.legs[1]))).toBe(false);
  // The button now offers the opposite action rather than repeating itself.
  await expect(legButton(page, /Show kite/)).toBeVisible();
  await expect(legButton(page, /Hide kite/)).toHaveCount(0);
  await legButton(page, /Show kite/).click();
  expect(await page.evaluate(() => legKiteHidden(state.legs[0]))).toBe(false);
});

test('only the nav kite stops drawing — every other marker is untouched', async ({ page }) => {
  await boot(page);
  await route(page);
  const drawn = await page.evaluate(() => {
    window.showCumTime = true; window.showReturn = true;
    window.showMidLeg = true; window.showWind = true; window.showDrift = true;
    const spies = {};
    for (const fn of ['drawLegArrow', 'drawCumTimeArrow', 'drawDistanceBadge',
      'drawMinuteMarkers', 'drawWindArrow', 'drawDriftLines']) {
      if (typeof window[fn] !== 'function') continue;
      const real = window[fn];
      spies[fn] = 0;
      window[fn] = function (...args) { spies[fn]++; return real.apply(this, args); };
    }
    const count = () => { for (const k of Object.keys(spies)) spies[k] = 0; draw(); return { ...spies }; };
    const before = count();
    state.legs[0].hideKite = 1;
    const after = count();
    return { before, after };
  });
  // Two fewer nav kites: this leg's inbound and its return.
  expect(drawn.before.drawLegArrow - drawn.after.drawLegArrow).toBe(2);
  // Everything else is the point of the narrow scope — hiding the kite is not hiding the leg.
  for (const k of ['drawCumTimeArrow', 'drawDistanceBadge', 'drawMinuteMarkers',
    'drawWindArrow', 'drawDriftLines']) {
    if (drawn.before[k] === undefined) continue;
    expect(drawn.after[k], k + ' changed, but only the kite should have').toBe(drawn.before[k]);
  }
});

test('a hidden kite is not clickable, but the cumulative-time kite still is', async ({ page }) => {
  await boot(page);
  await route(page);
  const r = await page.evaluate(() => {
    window.showCumTime = true; window.showReturn = true;
    draw();
    const at = () => ({
      kite: hitLegLabel(legLabelCenter(0, 'in').x, legLabelCenter(0, 'in').y),
      cum: hitCumLabel(cumLabelCenter(0).x, cumLabelCenter(0).y),
    });
    const before = at();
    state.legs[0].hideKite = 1;
    draw();
    const after = at();
    const other = legLabelCenter(1, 'in');
    return { before, after, otherStillHit: !!hitLegLabel(other.x, other.y) };
  });
  expect(r.before.kite).not.toBeNull();
  expect(r.before.cum).not.toBeNull();
  // An invisible object that still swallows clicks and drags is worse than a visible one.
  expect(r.after.kite).toBeNull();
  // ...but the cumulative-time kite is still drawn, so it must still be grabbable.
  expect(r.after.cum).not.toBeNull();
  // And this is per leg, not a mode.
  expect(r.otherStillHit).toBe(true);
});

test('clicking the line still selects a leg whose kite is hidden', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => { state.legs[0].hideKite = 1; draw(); });
  const sel = await selectLegByClickingItsLine(page, 0);
  // If the only handle for a leg were its kite, hiding it would be a one-way door.
  expect(sel.hit).toBe(0);
  expect(sel.selected).toEqual({ type: 'leg', index: 0 });
  await expect(legButton(page, /Show kite/)).toBeVisible();
});

test('the hidden-kite flag survives a reload and a save/load round-trip', async ({ page }) => {
  await boot(page);
  await route(page);
  await page.evaluate(() => { state.legs[1].hideKite = 1; persist(); writeRoute(); });
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('navaid.route')).legs.map(l => l.hideKite || 0));
  expect(stored).toEqual([0, 1]);
  await page.reload();
  await page.waitForFunction(() => state.legs.length === 2);
  expect(await page.evaluate(() => state.legs.map(l => l.hideKite || 0))).toEqual([0, 1]);
  // ...and through the canonical on-disk shape, so it reaches files and the route library.
  const round = await page.evaluate(() => {
    const doc = serializeRoute();
    const onWire = doc.legs.map(l => l.hideKite || 0);
    state.waypoints = []; state.legs = []; syncLegs();
    applyRouteData(doc);
    return { onWire, back: state.legs.map(l => l.hideKite || 0) };
  });
  expect(round.onWire).toEqual([0, 1]);
  expect(round.back).toEqual([0, 1]);
});

test('hiding the kite changes nothing in the flight plan', async ({ page }) => {
  await boot(page);
  await route(page);
  const rows = () => page.evaluate(() => {
    const t = document.querySelector('.modal-back.flight-plan .flight-table');
    return t ? Array.from(t.querySelectorAll('tbody tr'), r => r.textContent.replace(/\s+/g, ' ').trim()) : null;
  });
  await page.locator('#plan').click();
  await page.locator('.modal-back').waitFor();
  const before = await rows();
  await page.evaluate(() => {
    closeFlightPlan();
    state.legs[0].hideKite = 1;
  });
  await page.locator('.modal-back.flight-plan').waitFor({ state: 'detached' });
  await page.locator('#plan').click();
  await page.locator('.modal-back').waitFor();
  // This is a map-legibility control, not a change to the plan: the leg is still flown.
  expect(await rows()).toEqual(before);
});
