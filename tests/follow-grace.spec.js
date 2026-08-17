// @ts-check
// Following the own-ship recentres the map on every fix — about once a second. A pan or
// zoom by hand is a request to look at something else, and the next fix used to undo it
// before the pilot had read anything. A gesture now holds the view for a few seconds
// (followResumeMs), after which following resumes on its own: no button to remember to
// press again, which is what a manual follow toggle costs you in flight.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    window.__geoCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__geoCb = cb; return 4; };
    navigator.geolocation.clearWatch = () => {};
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof startLiveLocation === 'function' &&
    typeof gpsFollowSuspended === 'function');
}

// One fix at the given position, as the device would deliver it.
const fix = (page, lat, lng) => page.evaluate(([la, ln]) => {
  window.__geoCb({ coords: { latitude: la, longitude: ln, accuracy: 6, speed: 40, altitude: 300, heading: 90 }, timestamp: Date.now() });
}, [lat, lng]);

const centre = (page) => page.evaluate(() => {
  const c = map.getCenter();
  return { lat: c.lat, lng: c.lng };
});
// Leaflet snaps the centre to whole pixels, so a recentre lands within a pixel of the fix
// rather than exactly on it. Two decimals is ~1 km at this latitude: far tighter than the
// difference between "followed" and "held where the pilot put it" (which are degrees apart).
function expectCentre(actual, lat, lng) {
  expect(actual.lat).toBeCloseTo(lat, 2);
  expect(actual.lng).toBeCloseTo(lng, 2);
}

test('with no gesture, every fix recentres', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await fix(page, 32.00, 34.00);          // first fix always centres
  await fix(page, 32.20, 34.20);
  expectCentre(await centre(page), 32.20, 34.20);
});

test('a gesture holds the view, and following resumes by itself', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await fix(page, 32.00, 34.00);
  // The pilot drags the map away to look at something.
  await page.evaluate(() => {
    map.getContainer().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    map.setView([33.00, 35.00], map.getZoom());
  });
  const moved = await centre(page);
  await fix(page, 32.20, 34.20);
  const held = await centre(page);
  expectCentre(held, moved.lat, moved.lng);          // the fix did not snap it back
  expect(await page.evaluate(() => gpsFollowSuspended())).toBe(true);
  // Once the grace has passed, the next fix takes the map back.
  await page.evaluate(() => { _gpsUserMovedAt = Date.now() - (tune('followResumeMs') + 500); });
  expect(await page.evaluate(() => gpsFollowSuspended())).toBe(false);
  await fix(page, 32.30, 34.30);
  expectCentre(await centre(page), 32.30, 34.30);
});

test('each new gesture restarts the wait', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await fix(page, 32.00, 34.00);
  const stamps = await page.evaluate(async () => {
    const el = map.getContainer();
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const first = _gpsUserMovedAt;
    await new Promise((r) => setTimeout(r, 30));
    el.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));   // a zoom counts too
    return { first, second: _gpsUserMovedAt };
  });
  expect(stamps.second).toBeGreaterThan(stamps.first);
});

// The controls live INSIDE the map container and this watch runs in the capture phase, so
// without a filter every button in the corner counted as "the pilot moved the map" --
// opening the assistant stopped the map following the aircraft for five seconds.
test('tapping a map control is not a gesture', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => startLiveLocation());
  await fix(page, 32.00, 34.00);
  const out = await page.evaluate(() => {
    _gpsUserMovedAt = 0;
    const tap = (sel) => {
      const el = document.querySelector(sel);
      if (el) el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      return _gpsUserMovedAt;
    };
    const afterFab = tap('.assistant-fab');
    const afterZoom = tap('.leaflet-control-zoom-in');
    const afterDial = tap('#rotate-dial');
    // ...while the map itself still counts.
    map.getContainer().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    return { afterFab, afterZoom, afterDial, afterMap: _gpsUserMovedAt, suspended: gpsFollowSuspended() };
  });
  expect(out.afterFab).toBe(0);
  expect(out.afterZoom).toBe(0);
  expect(out.afterDial).toBe(0);
  expect(out.afterMap).toBeGreaterThan(0);
  expect(out.suspended).toBe(true);
});

test('the very first fix centres even straight after a gesture', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    startLiveLocation();
    map.getContainer().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    map.setView([33.00, 35.00], map.getZoom());
  });
  // Nothing on screen is worth preserving before the first fix: a pilot who opened the
  // app to find out where they are should be shown.
  await fix(page, 32.00, 34.00);
  expectCentre(await centre(page), 32.00, 34.00);
});

test('the wait is tunable, and zero means the old behaviour', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { setTune('followResumeMs', 0); startLiveLocation(); });
  await fix(page, 32.00, 34.00);
  await page.evaluate(() => {
    map.getContainer().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    map.setView([33.00, 35.00], map.getZoom());
  });
  await fix(page, 32.20, 34.20);
  expectCentre(await centre(page), 32.20, 34.20);   // snaps back at once
  await page.evaluate(() => setTune('followResumeMs', 5000));
});
