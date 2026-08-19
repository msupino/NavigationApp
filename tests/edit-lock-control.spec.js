// @ts-check
// A lock on the map that refuses to let anything on the ROUTE be moved: waypoints, nav kites,
// the cumulative-time kite, notes and comm callouts. Distinct from the follow lock beside it,
// which is about what the map does rather than what the route allows. On a phone a finger hits
// a waypoint disc as easily as the chart behind it, and a nudge rewrites a finished plan.
// The same lock already applies automatically while a fix is driving the map (dragLockedNow);
// this is that, on purpose, whenever the pilot wants it.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof dragLockedNow === 'function'
    && !!document.getElementById('edit-lock'));
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.80, name: 'ALPHA' },
      { lat: 32.30, lng: 35.10, name: 'BRAVO' },
    ];
    syncLegs();
    map.setView([32.15, 34.95], 10);
    draw();
  });
}

// A mouse press on a waypoint, a drag, and the release — through the real handlers.
const dragWaypoint = (page, i, dx, dy) => page.evaluate(([idx, mx, my]) => {
  const p = map.latLngToContainerPoint([state.waypoints[idx].lat, state.waypoints[idx].lng]);
  const fire = (type, pt) => map.fire(type, { containerPoint: pt, latlng: map.containerPointToLatLng(pt) });
  fire('mousedown', L.point(p.x, p.y));
  fire('mousemove', L.point(p.x + mx, p.y + my));
  if (typeof endMouseDrag === 'function') endMouseDrag();
  return { lat: state.waypoints[idx].lat, lng: state.waypoints[idx].lng };
}, [i, dx, dy]);

test('the button is on the map from the start, unlocked', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const b = document.getElementById('edit-lock');
    return { shown: getComputedStyle(b.parentNode).display !== 'none',
             pressed: b.getAttribute('aria-pressed'), locked: window.editLocked === true };
  });
  expect(out.shown).toBe(true);      // no fix needed: it is about the route, not the position
  expect(out.pressed).toBe('false');
  expect(out.locked).toBe(false);
});

test('locked, a waypoint drag moves nothing', async ({ page }) => {
  await boot(page);
  const before = await page.evaluate(() => ({ ...state.waypoints[0] }));
  await page.click('#edit-lock');
  const after = await dragWaypoint(page, 0, 60, 40);
  expect(after.lat).toBeCloseTo(before.lat, 6);
  expect(after.lng).toBeCloseTo(before.lng, 6);
});

test('unlocked, the same drag moves it', async ({ page }) => {
  await boot(page);
  const before = await page.evaluate(() => ({ ...state.waypoints[0] }));
  const after = await dragWaypoint(page, 0, 60, 40);
  expect(Math.abs(after.lat - before.lat) + Math.abs(after.lng - before.lng)).toBeGreaterThan(0);
});

test('it locks every draggable part of the route, not just the waypoint', async ({ page }) => {
  await boot(page);
  await page.click('#edit-lock');
  const locked = await page.evaluate(() =>
    ['wp', 'note', 'label', 'cumlabel', 'cumlabelret'].map(k => dragLockedNow(k)));
  expect(locked).toEqual([true, true, true, true, true]);
  // The page frame is print layout rather than route layout, so it stays free either way.
  expect(await page.evaluate(() => dragLockedNow('page'))).toBe(false);
});

test('it says which way it went, and is remembered on this device', async ({ page }) => {
  await boot(page);
  await page.click('#edit-lock');
  await expect(page.locator('.toast')).toHaveText(/locked/i);
  expect(await page.evaluate(() => localStorage.getItem('navaid.editLocked'))).toBe('1');
  await page.reload();
  await page.waitForFunction(() => !!document.getElementById('edit-lock'));
  const back = await page.evaluate(() => ({
    locked: window.editLocked === true,
    pressed: document.getElementById('edit-lock').getAttribute('aria-pressed'),
  }));
  expect(back.locked).toBe(true);
  expect(back.pressed).toBe('true');
});

// The automatic in-flight lock is unchanged: it exists because a nudge in the air rewrites the
// plan the alerts measure against, and it must not depend on the pilot having pressed anything.
test('a live position still locks the route on its own', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => dragLockedNow('wp'))).toBe(false);
  await page.evaluate(() => { window.gpsLiveOn = true; });
  expect(await page.evaluate(() => dragLockedNow('wp'))).toBe(true);
});
