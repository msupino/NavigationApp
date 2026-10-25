// @ts-check
// Regressions from the core.js audit: a coordinate parse that put DM without a space ~10 km
// off, a route check that dropped the near-route fields it had been sent, and a key deleted
// from the live gist that stayed in force until the next deploy.
const { test, expect } = require('./_setup');

const GIST_URL = /^https:\/\/gist\.githubusercontent\.com\//;

test.describe('go-to coordinates: minutes run straight into the hemisphere letter', () => {
  test('"32 05.5N 034 50.2E" and "32°05.5N 34°50.2E" are degrees + decimal minutes', async ({ page }) => {
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof parseLatLng === 'function');
    const got = await page.evaluate(() => [
      parseLatLng('32 05.5N 034 50.2E'),
      parseLatLng('32°05.5N 34°50.2E'),
      parseLatLng('32 00 17N 34 43 38E'),   // DMS with spaces is still DMS
    ]);
    for (const r of got.slice(0, 2)) {
      expect(r.lat).toBeCloseTo(32.09167, 4);
      expect(r.lng).toBeCloseTo(34.83667, 4);
    }
    expect(got[2].lat).toBeCloseTo(32.00472, 4);
    expect(got[2].lng).toBeCloseTo(34.72722, 4);
  });
});

test.describe('route check: weather at a field the route passes but does not name', () => {
  const T0 = Date.UTC(2026, 8, 16, 8, 0, 0);
  const run = (page, wx) => page.evaluate(({ wx, T0 }) => {
    window.airfields = [
      { icao: 'LLHA', lat: 32.81, lng: 35.04 },
      { icao: 'LLER', lat: 29.72, lng: 35.01 },
    ];
    return routeCheckFindings({
      // Up the coast past Haifa at 2,500 ft, then inland at 6,500 ft.
      waypoints: [
        { name: 'LLHZ', lat: 32.18, lng: 34.83 },
        { name: 'ATLIT', lat: 32.72, lng: 34.94 },
        { name: 'ROSH', lat: 33.09, lng: 35.11 },
        { name: 'LLIB', lat: 32.98, lng: 35.57 },
      ],
      legs: [{ inboundAltitude: 2500 }, { inboundAltitude: 2500 }, { inboundAltitude: 6500 }],
      legTimesH: [0.5, 0.3, 0.3],
      departAtMs: T0,
      airspace: [], notams: [], hazards: [], cloud: [],
      wx,
      contains: () => false,
    });
  }, { wx, T0 });

  test.beforeEach(async ({ page }) => {
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof routeCheckFindings === 'function');
  });

  test('BKN015 at LLHA under a 2,500 ft leg past it is a ceiling finding', async ({ page }) => {
    const got = await run(page, [{ icao: 'LLHA', clouds: [{ cover: 'BKN', base: 1500 }] }]);
    const f = got.findings.filter(x => x.kind === 'ceiling');
    expect(f).toHaveLength(1);
    expect(f[0].icao).toBe('LLHA');
    expect(f[0].altFt).toBe(2500);
  });

  test('a far field is still ignored, and a near one only counts against the legs passing it', async ({ page }) => {
    const far = await run(page, [{ icao: 'LLER', clouds: [{ cover: 'OVC', base: 500 }] }]);
    expect(far.findings).toEqual([]);
    // BKN060 would sit under the 6,500 ft inland leg, but that leg is nowhere near Haifa.
    const high = await run(page, [{ icao: 'LLHA', clouds: [{ cover: 'BKN', base: 6000 }] }]);
    expect(high.findings.filter(x => x.kind === 'ceiling')).toEqual([]);
  });
});

test.describe('gist: a key deleted from the live gist', () => {
  test.use({ useGistSnapshot: true });

  test('goes back to the built-in default once the live gist arrives', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('navaid.gistCache', JSON.stringify({ legKiteHeightPx: 41, waypointFillColor: '#123456' }));
    });
    await page.route(GIST_URL, route => route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ waypointFillColor: '#123456' }) }));
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof tune === 'function');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('navaid.gistCache')).legKiteHeightPx))
      .toBeUndefined();
    const got = await page.evaluate(() => ({
      kite: tune('legKiteHeightPx'),
      shipped: NavAid.tuningDefaults.legKiteHeightPx.value,
      colour: tune('waypointFillColor'),
    }));
    expect(got.kite).toBe(got.shipped);
    expect(got.colour).toBe('#123456');
  });

  test('a value that is not the gist\'s own is left alone', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('navaid.gistCache', JSON.stringify({ legKiteHeightPx: 41 }));
      window.__navaidTune = { legKiteHeightPx: 44 };
    });
    await page.route(GIST_URL, route => route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({}) }));
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof tune === 'function');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('navaid.gistCache'))).toBe('{}');
    expect(await page.evaluate(() => tune('legKiteHeightPx'))).toBe(44);
  });

  test('the baseline does not fall back to the snapshot when the cached gist lacks the key', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('navaid.gistCache', JSON.stringify({ waypointFillColor: '#123456' }));
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof tuneBaseline === 'function' && window.__navaidGistSnapshot);
    const got = await page.evaluate(() => {
      const k = Object.keys(window.__navaidGistSnapshot).find(key => NavAid.tuningDefaults[key]
        && NavAid.tuningDefaults[key].type !== 'text' && key !== 'waypointFillColor'
        && JSON.stringify(window.__navaidGistSnapshot[key]) !== JSON.stringify(NavAid.tuningDefaults[key].value));
      return { k, base: tuneBaseline(k), shipped: NavAid.tuningDefaults[k].value };
    });
    expect(got.k).toBeTruthy();
    expect(got.base).toBe(got.shipped);
  });
});
