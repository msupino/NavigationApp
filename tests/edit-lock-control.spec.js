// @ts-check
// A lock on the map that refuses to let anything on the ROUTE be moved: waypoints, nav kites,
// the cumulative-time kite, notes and comm callouts. Distinct from the follow lock beside it,
// which is about what the map does rather than what the route allows. On a phone a finger hits
// a waypoint disc as easily as the chart behind it, and a nudge rewrites a finished plan.
// The same lock already applies automatically while a fix is driving the map (dragLockedNow);
// this is that, on purpose, whenever the pilot wants it.
const { test, expect } = require('./_setup');

async function boot(page) {
  // Headless Chromium refuses geolocation, and the error callback ends the session a moment
  // after it starts -- which unlocks the route mid-test. A watch that simply never calls back
  // is what a phone sitting still looks like.
  await page.addInitScript(() => {
    navigator.geolocation.watchPosition = () => 7;
    navigator.geolocation.clearWatch = () => {};
  });
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

// Reported: starting a recording or Location locks the route on its own, and the button went
// on showing a pencil while every drag was being refused — a button that lies about what the
// chart will do.
test.describe('the button follows the automatic lock too', () => {
  const state_ = (page) => page.evaluate(() => {
    const b = document.getElementById('edit-lock');
    return { icon: b.textContent, pressed: b.getAttribute('aria-pressed'),
             label: b.getAttribute('aria-label'), locked: dragLockedNow('wp') };
  });

  test('showing a position pins it, and stopping releases it', async ({ page }) => {
    await boot(page);
    expect((await state_(page)).pressed).toBe('false');
    await page.evaluate(() => startLiveLocation());
    const live = await state_(page);
    expect(live.pressed).toBe('true');
    expect(live.icon).toBe('\u{1F512}');
    expect(live.locked).toBe(true);
    expect(live.label).toMatch(/while a position/i);
    await page.evaluate(() => stopLiveLocation());
    const after = await state_(page);
    expect(after.pressed).toBe('false');       // back to the pilot's own choice
    expect(after.icon).toBe('\u{1F513}');
  });

  // The pilot's own choice is remembered underneath: a route locked on the ground is still
  // locked when the flight ends.
  test('a lock set by hand survives a tracking session', async ({ page }) => {
    await boot(page);
    await page.click('#edit-lock');
    await page.evaluate(() => { startLiveLocation(); stopLiveLocation(); });
    const out = await state_(page);
    expect(out.pressed).toBe('true');
    expect(out.locked).toBe(true);
  });

  // The in-flight lock is a default, not a rule: a diversion gets planned in the air, and a
  // pilot who means to move a waypoint has to be able to. One tap lifts it.
  test('a tap in the air lifts the lock, and another puts it back', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => startLiveLocation());
    expect(await page.evaluate(() => dragLockedNow('wp'))).toBe(true);
    await page.click('#edit-lock');
    await expect(page.locator('.toast')).toHaveText(/this flight/i);
    const open_ = await page.evaluate(() => ({
      locked: dragLockedNow('wp'),
      pressed: document.getElementById('edit-lock').getAttribute('aria-pressed'),
      stored: localStorage.getItem('navaid.editLocked'),
    }));
    expect(open_.locked).toBe(false);
    expect(open_.pressed).toBe('false');
    expect(open_.stored).toBe(null);        // an exception, not a new preference
    await page.click('#edit-lock');
    expect(await page.evaluate(() => dragLockedNow('wp'))).toBe(true);
  });

  // Unlocking really does let the waypoint move — the point of the exception.
  test('unlocked in the air, a waypoint drag moves it', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => startLiveLocation());
    const before = await page.evaluate(() => ({ ...state.waypoints[0] }));
    await page.click('#edit-lock');
    const after = await dragWaypoint(page, 0, 60, 40);
    expect(Math.abs(after.lat - before.lat) + Math.abs(after.lng - before.lng)).toBeGreaterThan(0);
  });

  // The exception lasts one session: the next flight starts locked whatever happened on the
  // last one, because that is the state a pilot who never touches the button should get.
  test('the next session starts locked again', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => startLiveLocation());
    await page.click('#edit-lock');                  // unlocked for this flight
    await page.evaluate(() => { stopLiveLocation(); startLiveLocation(); });
    expect(await page.evaluate(() => dragLockedNow('wp'))).toBe(true);
  });
});

// The two locks sat in one column wearing the same padlock, which said nothing about which
// lock was which. The padlock belongs to the one that refuses input; the follow lock gets a
// gun sight, because it locks the map ONTO the aircraft.
test('the two locks do not wear the same icon', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());       // both controls visible
  const icons = await page.evaluate(() => ({
    edit: document.getElementById('edit-lock').textContent,
    follow: document.getElementById('follow-lock').textContent,
  }));
  expect(icons.edit).not.toBe(icons.follow);
  expect(icons.follow).toBe('\u{1F3AF}');              // 🎯 locked onto the aircraft
  await page.click('#follow-lock');
  expect(await page.evaluate(() => document.getElementById('follow-lock').textContent))
    .toBe('⭕');                                   // ⭕ nothing held
});
