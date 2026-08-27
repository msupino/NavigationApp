// Re-engaging follow is a request to fly the map, not to keep reading it.
//
// The zoom a pilot reads the chart at is usually not the zoom to fly at: out to see the
// whole route, or in on a field's circuit. Follow re-centred at whatever zoom it found, so
// tapping the lock after a look at the route put the aircraft in the middle of a view there
// was no navigating from — and the pilot had to zoom back by hand every time.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof gpsSetFollow === 'function'
    && typeof gpsFollowZoom === 'function');
  await page.evaluate(() => {
    window.gpsOwn = { lat: 32.0, lng: 34.9 };
    gpsSetFollow(false);
  });
}

const engageAt = (page, z) => page.evaluate((zoom) => {
  map.setView([31.0, 35.5], zoom);      // somewhere else, at the pilot's chosen zoom
  gpsSetFollow(true);
  const c = map.getCenter();
  return { zoom: map.getZoom(), lat: +c.lat.toFixed(3), lng: +c.lng.toFixed(3) };
}, z);

test('zoomed out to see the whole route, engaging follow zooms back in', async ({ page }) => {
  await boot(page);
  const got = await engageAt(page, 7);
  expect(got.zoom).toBe(10);            // followZoomFloor
  expect(got.lat).toBe(32);             // ...and it still centres on the aircraft
  expect(got.lng).toBe(34.9);
});

test('zoomed right in on a circuit, engaging follow zooms back out', async ({ page }) => {
  await boot(page);
  expect((await engageAt(page, 17)).zoom).toBe(14);   // followZoomCeiling
});

test('a zoom already fit to fly at is left exactly as the pilot set it', async ({ page }) => {
  await boot(page);
  for (const z of [10, 12, 14]) {
    await page.evaluate(() => gpsSetFollow(false));
    expect((await engageAt(page, z)).zoom).toBe(z);
  }
});

// The band is the gist's to move, and a nonsense band must not silently re-frame the map.
test('the band is tunable, and an inverted one changes nothing', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    setTune('followZoomFloor', 12);
    setTune('followZoomCeiling', 13);
    const tightened = gpsFollowZoom(8);
    setTune('followZoomFloor', 15);        // min above max: not a band at all
    setTune('followZoomCeiling', 9);
    return { tightened, nonsense: gpsFollowZoom(8) };
  });
  expect(got.tightened).toBe(12);
  expect(got.nonsense).toBe(8);          // left alone rather than clamped to either end
});

// Following at 1 Hz must not fight a pilot who zooms in while it is already on.
test('a fix-driven recentre keeps whatever zoom it finds', async ({ page }) => {
  await boot(page);
  const after = await page.evaluate(() => {
    gpsSetFollow(true);
    // The deepest the active chart allows -- setZoom past it is clamped, so asking for 17
    // and expecting 17 would fail on the map's own limit rather than on this behaviour.
    const deep = map.getMaxZoom();
    map.setZoom(deep);                   // the pilot zooms in mid-flight
    window._gpsUserMovedAt = 0;          // ...and the grace period lapses
    gpsFollowRecenter(32.0, 34.9);       // the next fix arrives
    return { after: map.getZoom(), deep };
  });
  expect(after.after).toBe(after.deep);
  expect(after.deep).toBeGreaterThan(14);   // ...and it is outside the band, so this proves it
});
