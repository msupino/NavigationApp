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

// How much chart to fly with depends on where the aeroplane is. Inside a control zone the
// questions are close-in ones -- which reporting point, which runway, where the traffic is --
// and a 40-mile view answers none of them. En route the opposite.
const engageAtPlace = (page, zoom, lat, lng) => page.evaluate(async (p) => {
  if (typeof loadAirspace === 'function') await loadAirspace();
  window.gpsOwn = { lat: p.lat, lng: p.lng };
  gpsSetFollow(false);
  map.setView([p.lat, p.lng], p.zoom);
  gpsSetFollow(true);
  return { zoom: map.getZoom(), inCtr: gpsInsideCtr(p.lat, p.lng) };
}, { zoom, lat, lng });

test('over Ben Gurion CTR, engaging follow keeps a close-in view', async ({ page }) => {
  await boot(page);
  const got = await engageAtPlace(page, 7, 31.9992, 34.8894);
  expect(got.inCtr).toBe(true);
  expect(got.zoom).toBe(12);            // followZoomCtrFloor, not the en-route 10
});

test('over the Negev, the en-route band applies', async ({ page }) => {
  await boot(page);
  const got = await engageAtPlace(page, 7, 30.6, 34.9);   // clear of every CTR
  expect(got.inCtr).toBe(false);
  expect(got.zoom).toBe(10);            // followZoomFloor
});

test('a CTR zoom the pilot chose inside the band is left alone', async ({ page }) => {
  await boot(page);
  expect((await engageAtPlace(page, 14, 32.8542, 35.0548)).zoom).toBe(14);   // Haifa CTR
});

// The layer being switched off does not move the aeroplane: the test is geometry, not
// what the pilot has chosen to draw.
test('CTR awareness does not depend on the airspace layer being on', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    if (typeof loadAirspace === 'function') await loadAirspace();
    window.showAirspace = false;
    return { off: gpsInsideCtr(31.9992, 34.8894),
             viaLayer: (typeof airspaceAtLatLng === 'function')
               ? airspaceAtLatLng({ lat: 31.9992, lng: 34.8894 }).length : -1 };
  });
  expect(got.off).toBe(true);           // still inside the CTR...
  expect(got.viaLayer).toBe(0);         // ...even though the layer answers with nothing
});

// The moment most flights actually start: Location on, follow already on (the default), so
// gpsSetFollow is never called. The band was unreachable that way -- you had to toggle the
// switch off and on to see it.
const firstFixAt = (page, zoom, lat, lng) => page.evaluate(async (p) => {
  if (typeof loadAirspace === 'function') await loadAirspace();
  window.gpsFollow = true;
  window.gpsLiveOn = true;
  window.gpsRecording = false;
  window._gpsLivePrev = null;                        // no fix yet: the next one is the first
  window._gpsUserMovedAt = 0;
  map.setView([p.lat + 0.5, p.lng + 0.5], p.zoom);   // wherever the pilot was looking
  // Through the real handler, so this exercises the path Location actually takes.
  onLivePosition({ coords: { latitude: p.lat, longitude: p.lng, accuracy: 5 },
                   timestamp: Date.now() });
  const c = map.getCenter();
  return { zoom: map.getZoom(), lat: +c.lat.toFixed(3), lng: +c.lng.toFixed(3) };
}, { zoom, lat, lng });

test('the first fix frames the aeroplane, not just centres it', async ({ page }) => {
  await boot(page);
  const got = await firstFixAt(page, 7, 30.6, 34.9);   // en route, clear of every CTR
  expect(got.lat).toBe(30.6);                          // centred on the aeroplane...
  expect(got.zoom).toBe(10);                           // ...and zoomed to fly with
});

test('the first fix inside a CTR uses the CTR band', async ({ page }) => {
  await boot(page);
  expect((await firstFixAt(page, 7, 31.9992, 34.8894)).zoom).toBe(12);   // LLBG CTR
});

test('a first fix at a zoom already fit to fly at is left alone', async ({ page }) => {
  await boot(page);
  expect((await firstFixAt(page, 12, 30.6, 34.9)).zoom).toBe(12);
});
