// @ts-check
// Tests for the #162 shareable route link.
const { test, expect } = require('@playwright/test');

// Same 11-waypoint LLHZ → LLHA fixture as tests/flight-plan.spec.js (PR #153),
// coords copied from docs/airfields.json + docs/nav-waypoints.json at 5 dp.
const ROUTE = {
  waypoints: [
    { lat: 32.18060, lng: 34.83470, name: 'LLHZ' },
    { lat: 32.21861, lng: 34.88250, name: 'BAZRA' },
    { lat: 32.25722, lng: 34.89111, name: 'DEROR' },
    { lat: 32.32306, lng: 34.90389, name: 'SHARO' },
    { lat: 32.46472, lng: 34.91222, name: 'HADRA' },
    { lat: 32.59194, lng: 34.94639, name: 'FRDIS' },
    { lat: 32.71444, lng: 34.97083, name: 'BOREN' },
    { lat: 32.75389, lng: 34.93694, name: 'HOTRM' },
    { lat: 32.79611, lng: 34.94333, name: 'DAROM' },
    { lat: 32.84111, lng: 34.98111, name: 'GALIM' },
    { lat: 32.80972, lng: 35.04389, name: 'LLHA' },
  ],
  legs: Array(10).fill(null).map(() => ({
    inboundAltitude: 1500,
    outboundAltitude: 2000,
    flightSpeed: 90,
  })),
};

test.describe('Share route link', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        for (const s of ['edit','map','route','display','print','build','view','numbers','export']) {
          localStorage.setItem('navaid.sec.' + s, '1');
        }
      } catch (e) {}
    });
  });

  test('polyline encode/decode round-trips at 5 dp precision', async ({ page }) => {
    await page.goto('/?lang=en');
    await page.waitForFunction(() => typeof polylineEncode === 'function');
    const out = await page.evaluate(route => {
      const pts = route.waypoints.map(w => [w.lat, w.lng]);
      const enc = polylineEncode(pts);
      const dec = polylineDecode(enc);
      return { enc, dec };
    }, ROUTE);
    expect(out.enc.length).toBeGreaterThan(0);
    expect(out.dec).toHaveLength(ROUTE.waypoints.length);
    for (let i = 0; i < ROUTE.waypoints.length; i++) {
      expect(out.dec[i][0]).toBeCloseTo(ROUTE.waypoints[i].lat, 5);
      expect(out.dec[i][1]).toBeCloseTo(ROUTE.waypoints[i].lng, 5);
    }
  });

  test('buildShareUrl produces a URL containing r/n/l params', async ({ page }) => {
    await page.goto('/?lang=en');
    await page.evaluate(route => {
      state.waypoints = route.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
      state.legs = route.legs.map(l => ({
        inboundAltitude: l.inboundAltitude,
        outboundAltitude: l.outboundAltitude,
        flightSpeed: l.flightSpeed,
        outboundSpeed: l.flightSpeed,
        inLabel: { a: 0, p: 44 },
        outLabel: { a: 0, p: -44 },
      }));
      syncLegs();
    }, ROUTE);
    const built = await page.evaluate(() => buildShareUrl());
    expect(built.url).toBeTruthy();
    const u = new URL(built.url);
    expect(u.searchParams.get('r')).toBeTruthy();
    expect(u.searchParams.get('n')).toBeTruthy();
    expect(u.searchParams.get('l')).toBeTruthy();
  });

  test('share URL stays under WhatsApp preview budget for 20 waypoints', async ({ page }) => {
    await page.goto('/?lang=en');
    const len = await page.evaluate(() => {
      state.waypoints = [];
      for (let i = 0; i < 20; i++) {
        state.waypoints.push({
          lat: 32 + i * 0.05,
          lng: 35 + i * 0.05,
          name: 'WP' + i,
        });
      }
      syncLegs();
      return buildShareUrl().url.length;
    });
    expect(len).toBeLessThan(1800);
  });

  test('errShareTooLong when over 64 waypoints', async ({ page }) => {
    await page.goto('/?lang=en');
    const out = await page.evaluate(() => {
      state.waypoints = [];
      for (let i = 0; i < 70; i++) {
        state.waypoints.push({ lat: 32 + i * 0.01, lng: 35, name: '' });
      }
      syncLegs();
      return buildShareUrl();
    });
    expect(out.err).toBe('errShareTooLong');
  });

  test('opening a URL with ?r=&n=&l= loads the encoded route', async ({ page }) => {
    // First build the URL on a fresh app instance, then open a second one
    // with that URL and verify the state matches.
    await page.goto('/?lang=en');
    const url = await page.evaluate(route => {
      state.waypoints = route.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
      state.legs = route.legs.map(l => ({
        inboundAltitude: l.inboundAltitude,
        outboundAltitude: l.outboundAltitude,
        flightSpeed: l.flightSpeed,
        outboundSpeed: l.flightSpeed,
        inLabel: { a: 0, p: 44 },
        outLabel: { a: 0, p: -44 },
      }));
      return buildShareUrl().url;
    }, ROUTE);
    const target = '/' + url.split('/').pop();   // strip origin
    await page.goto(target);
    await page.waitForFunction(() => typeof state !== 'undefined' && state.waypoints.length > 0);
    const loaded = await page.evaluate(() => ({
      wps: state.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name })),
      legs: state.legs.map(l => ({
        inboundAltitude: l.inboundAltitude,
        outboundAltitude: l.outboundAltitude,
        flightSpeed: l.flightSpeed,
        outboundSpeed: l.outboundSpeed,
      })),
    }));
    expect(loaded.wps).toHaveLength(ROUTE.waypoints.length);
    for (let i = 0; i < ROUTE.waypoints.length; i++) {
      expect(loaded.wps[i].lat).toBeCloseTo(ROUTE.waypoints[i].lat, 4);
      expect(loaded.wps[i].lng).toBeCloseTo(ROUTE.waypoints[i].lng, 4);
      expect(loaded.wps[i].name).toBe(ROUTE.waypoints[i].name);
    }
    expect(loaded.legs).toHaveLength(ROUTE.legs.length);
    for (let i = 0; i < ROUTE.legs.length; i++) {
      expect(loaded.legs[i].inboundAltitude).toBe(ROUTE.legs[i].inboundAltitude);
      expect(loaded.legs[i].outboundAltitude).toBe(ROUTE.legs[i].outboundAltitude);
      expect(loaded.legs[i].flightSpeed).toBe(ROUTE.legs[i].flightSpeed);
    }
  });

  test('Hebrew waypoint names round-trip through the share URL', async ({ page }) => {
    await page.goto('/?lang=he');
    const url = await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.18, lng: 34.83, name: 'הרצליה' },
        { lat: 32.81, lng: 35.04, name: 'חיפה' },
      ];
      syncLegs();
      return buildShareUrl().url;
    });
    const target = '/' + url.split('/').pop();
    await page.goto(target);
    await page.waitForFunction(() => typeof state !== 'undefined' && state.waypoints.length === 2);
    const names = await page.evaluate(() => state.waypoints.map(w => w.name));
    expect(names).toEqual(['הרצליה', 'חיפה']);
  });

  test('share button click writes the URL to clipboard', async ({ page }) => {
    await page.goto('/?lang=en');
    await page.evaluate(route => {
      state.waypoints = route.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
      state.legs = route.legs.map(l => ({
        inboundAltitude: l.inboundAltitude,
        outboundAltitude: l.outboundAltitude,
        flightSpeed: l.flightSpeed,
        outboundSpeed: l.flightSpeed,
        inLabel: { a: 0, p: 44 },
        outLabel: { a: 0, p: -44 },
      }));
    }, ROUTE);
    page.once('dialog', d => d.accept());        // share-success alert
    await page.locator('#share').click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('r=');
    expect(clip).toContain('n=');
    expect(clip).toContain('l=');
  });
});
