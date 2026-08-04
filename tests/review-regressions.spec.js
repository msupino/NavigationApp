// @ts-check
// Regression tests for the full-codebase code-review pass: the two classes that
// recurred most (per-leg wind dropped on Reverse; route-wide wind not reset on a
// full-route replacement) plus the GPX <ele> unit fix. State-level so they stay
// fast and deterministic.
const { test, expect } = require('./_setup');

const ROUTE = {
  waypoints: [
    { lat: 32.00, lng: 34.80, name: 'A' },
    { lat: 32.10, lng: 34.85, name: 'B' },
    { lat: 32.20, lng: 34.90, name: 'C' },
    { lat: 32.30, lng: 34.95, name: 'D' },
  ],
};

async function bootRoute(page) {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof syncLegs === 'function' && typeof draw === 'function');
  await page.evaluate(route => {
    state.waypoints = route.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
    state.legs = [];
    state.notes = [];
    state.commChangeSuppressions = [];
    syncLegs();
    draw();
  }, ROUTE);
}

test('Reverse preserves per-leg winds-aloft (leg.wind is absolute, not dropped)', async ({ page }) => {
  await bootRoute(page);
  const r = await page.evaluate(() => {
    window.showReturn = false;
    state.legs[1].wind = { dir: 45, speed: 12 };   // per-leg winds-aloft on one leg
    return { before: state.legs.filter(l => l.wind && l.wind.speed === 12).length };
  });
  expect(r.before).toBe(1);
  // Fire the handler directly — the #reverse button lives in a collapsed
  // toolbar section, so a UI click would need the section opened first.
  await page.evaluate(() => document.getElementById('reverse').click());
  await page.waitForTimeout(50);
  const after = await page.evaluate(() =>
    state.legs.filter(l => l.wind && l.wind.dir === 45 && l.wind.speed === 12).length);
  expect(after).toBe(1);   // wind survived the reverse (was silently dropped before the fix)
});

test('Clear resets route-wide wind so a new route does not inherit it', async ({ page }) => {
  await bootRoute(page);
  page.on('dialog', d => d.accept());
  await page.evaluate(() => { state.wind = { dir: 90, speed: 20 }; });
  await page.evaluate(() => document.getElementById('clear').click());   // collapsed-toolbar button → fire directly
  await page.waitForTimeout(50);
  const wind = await page.evaluate(() => ({ speed: state.wind && state.wind.speed }));
  expect(wind.speed).toBe(0);        // wind reset to calm (was inherited before the fix)
});

test('GPX export writes track elevation in metres, not feet-deflated', async ({ page }) => {
  await bootRoute(page);
  const has = await page.evaluate(() => {
    if (typeof gpsTrackToGpx !== 'function') throw new Error('gpsTrackToGpx is not exposed');
    const gpx = gpsTrackToGpx({ name: 'T', track: [
      { lat: 32.0, lng: 34.8, t: 1, alt: 914 },   // 914 m (~3000 ft)
      { lat: 32.1, lng: 34.9, t: 2, alt: 915 },
    ] });
    return gpx;
  });
  expect(has).toContain('<ele>914</ele>');       // metres, not 914/3.28 = 278.6
  expect(has).not.toContain('<ele>278');
});
