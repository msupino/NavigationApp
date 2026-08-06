// @ts-check
// Every "frame the map on X" call used to carry its own hardcoded padding and maxZoom, so
// the two a pilot actually notices — the route auto-fit and ⌖ Fit to screen — did not even
// agree with each other (80px vs 70px), and none of it was reachable from ?tune=1.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const app = rel => fs.readFileSync(path.join(__dirname, '..', 'docs', 'app', rel), 'utf8');

const KEYS = [
  'fitRoutePaddingPx', 'fitRouteMaxZoom', 'fitRouteEmptyZoom',
  'fitNotamPaddingPx', 'fitNotamMaxZoom', 'fitNotamPointZoom',
  'fitTrackPaddingPx', 'fitTrackMaxZoom', 'fitTrackPointZoom',
  'fitAltPairPaddingPx', 'fitAltPairMaxZoom',
  'fitAreaPaddingPx', 'fitAreaMaxZoom', 'fitBoxPaddingPx',
];

async function boot(page) {
  await page.goto('?lang=en&nogist&tune=1');
  await page.waitForFunction(() => typeof tune === 'function' &&
    typeof fitOpts === 'function' && typeof fitView === 'function' &&
    typeof state !== 'undefined' && typeof map !== 'undefined');
}

test('no fit call carries its own padding literal any more', () => {
  for (const f of ['core.js', 'draw.js', 'interact.js', 'io.js', 'ui.js', 'gps.js']) {
    const src = app(f);
    // The literals are what made these unreachable from the tuning panel, and what let the
    // route fit and Fit-to-screen drift apart.
    const stragglers = src.split('\n')
      .filter(l => /fitBounds\(/.test(l) && /padding:\s*\[/.test(l));
    expect(stragglers, f + ' still fits with a literal padding').toEqual([]);
  }
});

test('every fit tunable is registered, bounded, and in the panel group', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(keys => {
    const defs = NavAid.tuningDefaults || {};
    const groups = NavAid.tuningGroups || [];
    const mapFit = groups.find(g => g.name === 'Map fit');
    return {
      missing: keys.filter(k => !defs[k]),
      badRange: keys.filter(k => {
        const d = defs[k];
        return !d || !(d.min < d.max) || !(d.value >= d.min && d.value <= d.max) || !(d.step > 0);
      }),
      unlabelled: keys.filter(k => !defs[k] || !defs[k].label),
      grouped: !!mapFit && keys.every(k => mapFit.keys.includes(k)),
      // The first-run view keys belong with them rather than stranded elsewhere.
      hasViewKeys: !!mapFit && ['defaultViewZoom', 'defaultViewLat', 'defaultViewLng']
        .every(k => mapFit.keys.includes(k)),
    };
  }, KEYS);
  expect(r.missing).toEqual([]);
  expect(r.badRange).toEqual([]);
  expect(r.unlabelled).toEqual([]);
  expect(r.grouped).toBe(true);
  expect(r.hasViewKeys).toBe(true);
  await expect(page.locator('#tuning-panel')).toContainText('Map fit');
});

test('fitOpts turns the registry into Leaflet options', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    NavAid.tuning.fitRoutePaddingPx = 25;
    NavAid.tuning.fitRouteMaxZoom = 12.5;
    const withZoom = fitOpts('fitRoutePaddingPx', 'fitRouteMaxZoom');
    const noZoom = fitOpts('fitBoxPaddingPx', null);
    const extra = fitOpts('fitRoutePaddingPx', 'fitRouteMaxZoom', { animate: false });
    NavAid.tuning.fitRoutePaddingPx = -40;             // nonsense from a gist
    const clamped = fitOpts('fitRoutePaddingPx', 'fitRouteMaxZoom');
    NavAid.tuning.fitRoutePaddingPx = undefined;
    NavAid.tuning.fitRouteMaxZoom = undefined;
    return { withZoom, noZoom, extra, clamped };
  });
  expect(r.withZoom).toEqual({ padding: [25, 25], maxZoom: 12.5 });
  // A metre-box fit has no maxZoom at all; inventing one would change what it frames.
  expect(r.noZoom.maxZoom).toBeUndefined();
  expect(r.noZoom.padding[0]).toBeGreaterThan(0);
  expect(r.extra).toMatchObject({ animate: false });
  // Padding is a pixel inset — a negative one would push the route off screen.
  expect(r.clamped.padding).toEqual([0, 0]);
});

test('the route fit honours its max zoom and its padding', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const hz = airfieldByIcao('LLHZ');
    // A close pair, so the fit is decided by maxZoom rather than by the span.
    state.waypoints = [{ lat: hz.lat, lng: hz.lng, name: 'A' },
      { lat: hz.lat + 0.02, lng: hz.lng + 0.02, name: 'B' }];
    syncLegs(); draw();
    const at = z => { NavAid.tuning.fitRouteMaxZoom = z; fitView(); return map.getZoom(); };
    const out = { z9: at(9), z11: at(11), z14: at(14) };
    NavAid.tuning.fitRouteMaxZoom = 18;
    NavAid.tuning.fitRoutePaddingPx = 0;
    fitView(); out.pad0 = map.getZoom();
    NavAid.tuning.fitRoutePaddingPx = 180;
    fitView(); out.pad180 = map.getZoom();
    NavAid.tuning.fitRouteMaxZoom = undefined;
    NavAid.tuning.fitRoutePaddingPx = undefined;
    return out;
  });
  expect(r.z9).toBeLessThanOrEqual(9);
  expect(r.z11).toBeLessThanOrEqual(11);
  expect(r.z14).toBeLessThanOrEqual(14);
  expect(r.z9).toBeLessThan(r.z14);          // the cap is what is doing the work
  // More padding means a wider view, never a tighter one.
  expect(r.pad180).toBeLessThan(r.pad0);
});

test('Fit to screen with no route uses the first-run centre and its own zoom', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.waypoints = []; syncLegs();
    NavAid.tuning.fitRouteEmptyZoom = 8;
    fitView();
    const c = map.getCenter();
    NavAid.tuning.fitRouteEmptyZoom = undefined;
    return { zoom: map.getZoom(), lat: Math.round(c.lat * 100) / 100,
      lng: Math.round(c.lng * 100) / 100,
      wantLat: Math.round(tune('defaultViewLat') * 100) / 100,
      wantLng: Math.round(tune('defaultViewLng') * 100) / 100 };
  });
  // It used to be a literal setView([32.0, 34.9], 9) — a second, slightly different
  // "default view" from the one defaultViewLat/Lng already defined.
  expect(r.zoom).toBe(8);
  expect(r.lat).toBe(r.wantLat);
  expect(r.lng).toBe(r.wantLng);
});
