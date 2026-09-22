// @ts-check
// A coordinate has to be a position, not merely a number.
//
// validateRoute type-checked lat and lng and stopped there, so a corrupt share link decoded
// to lat -21474.83648 and sailed through the schema gate. That matters more than a nonsense
// route on screen: tryLoadRouteFromUrl() returning true makes boot SKIP restoreRoute(), so
// opening a bad link displaced the pilot's own saved route with a point that cannot exist --
// on nothing louder than a console.warn.
//
// The range check goes in validateRoute rather than in the share decoder, because that is
// the one gate all three producers pass through: the file import, the localStorage restore
// and the share link.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof validateRoute === 'function'
    && typeof decodeShareUrl === 'function');
}

// The baseline comes from the app, not from hand-rolled JSON: validateRoute also checks
// that legs.length === waypoints.length - 1, and a fixture that trips a DIFFERENT rule
// would prove nothing about the one under test.
const validRoute = page => page.evaluate(() => {
  state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'A' }, { lat: 32.78, lng: 35.04, name: 'B' }];
  syncLegs();
  return JSON.parse(JSON.stringify(serializeRoute()));
});

test('a coordinate outside the globe is refused', async ({ page }) => {
  await boot(page);
  const good = await validRoute(page);
  const verdicts = await page.evaluate((good) => {
    const at = (lat, lng) => {
      const r = JSON.parse(JSON.stringify(good));
      r.waypoints[0].lat = lat; r.waypoints[0].lng = lng;
      return validateRoute(r) || 'ACCEPTED';
    };
    return {
      sane: at(32.18, 34.83),
      latLow: at(-21474.83648, 0),      // the value a corrupt share link actually produced
      latHigh: at(91, 0),
      lngLow: at(0, -181),
      lngHigh: at(0, 180.5),
      edgeLat: at(90, 180),             // the poles and the antimeridian are real places
      edgeNeg: at(-90, -180),
    };
  }, good);
  expect(verdicts.sane).toBe('ACCEPTED');
  expect(verdicts.edgeLat, '±90/±180 are valid positions').toBe('ACCEPTED');
  expect(verdicts.edgeNeg).toBe('ACCEPTED');
  for (const k of ['latLow', 'latHigh', 'lngLow', 'lngHigh']) {
    expect(verdicts[k], k + ' should have been refused').not.toBe('ACCEPTED');
  }
});

test('the share link that produced it is refused end to end', async ({ page }) => {
  await boot(page);
  const seen = await page.evaluate(() => {
    const decoded = decodeShareUrl('?r=' + 'z'.repeat(5000) + '&n=&l=');
    if (!decoded) return { decoded: false };
    return { decoded: true, lat: decoded.waypoints[0].lat, verdict: validateRoute(decoded) || 'ACCEPTED' };
  });
  // The decoder is allowed to be permissive; the gate in front of state is not.
  if (seen.decoded) {
    expect(Math.abs(seen.lat), 'the fixture no longer produces an impossible latitude')
      .toBeGreaterThan(90);
    expect(seen.verdict, 'an impossible latitude reached state').not.toBe('ACCEPTED');
  }
});

test('a real route still loads', async ({ page }) => {
  await boot(page);
  // The guard must not cost the thing it protects: a genuine share link still round-trips.
  const roundTripped = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.78, lng: 35.04, name: 'LLHA' }];
    syncLegs();
    const built = buildShareUrl();
    if (!built || built.err) return 'build failed: ' + (built && built.err);
    const q = built.url ? built.url.slice(built.url.indexOf('?')) : built;
    const back = decodeShareUrl(typeof q === 'string' ? q : '');
    if (!back) return 'decode failed';
    return validateRoute(back) || 'ACCEPTED';
  });
  expect(roundTripped).toBe('ACCEPTED');
});
