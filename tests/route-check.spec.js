// @ts-check
// "Can I fly this plan, at the time I mean to fly it?" Four things can say no, and each of
// them already knew its own half: the airspace inspector knew the route crossed a CTR, the
// NOTAM list knew a field was closed, the SIGMET layer knew where the weather was, the METAR
// knew the ceiling. None of them looked at the plan, and none of them looked at WHEN.
//
// Time is what makes this a check rather than a list, so most of what is tested here is time:
// a NOTAM that lifts before the aeroplane arrives is not a finding, and a danger area that
// goes live after it has passed is not one either.
const { test, expect } = require('./_setup');

const HOUR = 3600000;
const T0 = Date.UTC(2026, 8, 16, 8, 0, 0);

// A straight north-east run, three legs of roughly half an hour each.
const ROUTE = {
  waypoints: [
    { name: 'LLHZ', lat: 32.18, lng: 34.83 },
    { name: 'BAZRA', lat: 32.45, lng: 35.00 },
    { name: 'DEROR', lat: 32.70, lng: 35.25 },
    { name: 'LLIB', lat: 32.98, lng: 35.57 },
  ],
  legs: [
    { inboundAltitude: 3000 }, { inboundAltitude: 3000 }, { inboundAltitude: 3000 },
  ],
  legTimesH: [0.5, 0.5, 0.5],
  departAtMs: T0,
};

const run = (page, extra) => page.evaluate(
  (args) => routeCheckFindings(Object.assign({}, args.route, args.extra, {
    contains: (a, p) => routeCheckPointInRing(p, a.ring),
  })),
  { route: ROUTE, extra: extra || {} });

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof routeCheckFindings === 'function');
}

test('with no data at all it says which sources it could not read', async ({ page }) => {
  await boot(page);
  const got = await run(page);
  expect(got.findings).toEqual([]);
  // "No NOTAMs" and "no NOTAM data" are opposite answers to a pilot.
  expect(got.unchecked.sort()).toEqual(['airspace', 'ceiling', 'cloud', 'hazards', 'notams']);
});

test('the window is the departure time plus the legs, not now', async ({ page }) => {
  await boot(page);
  const got = await run(page, { airspace: [], notams: [], hazards: [], wx: [], cloud: [] });
  expect(got.from).toBe(T0);
  expect(got.to).toBe(T0 + 1.5 * HOUR);
  expect(got.unchecked).toEqual([]);
});

test.describe('airspace', () => {
  // A box around the middle leg, surface to 4,500.
  const CTR = {
    name: 'TEL AVIV CTR', class: 'C', lowerFt: 0, upperFt: 4500,
    ring: [[32.4, 34.9], [32.4, 35.4], [32.8, 35.4], [32.8, 34.9]],
  };

  test('a leg inside the limits is a stop', async ({ page }) => {
    await boot(page);
    const got = await run(page, { airspace: [CTR] });
    const f = got.findings.filter(x => x.kind === 'airspace');
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('stop');
    expect(f[0].name).toBe('TEL AVIV CTR');
    expect(f[0].altFt).toBe(3000);
  });

  test('crossing above the top is not a finding', async ({ page }) => {
    await boot(page);
    const low = Object.assign({}, CTR, { upperFt: 2000 });
    const got = await run(page, { airspace: [low] });
    expect(got.findings.filter(x => x.kind === 'airspace')).toEqual([]);
  });

  test('crossing below the base is not a finding either', async ({ page }) => {
    await boot(page);
    const high = Object.assign({}, CTR, { lowerFt: 5000, upperFt: 9000 });
    expect((await run(page, { airspace: [high] })).findings
      .filter(x => x.kind === 'airspace')).toEqual([]);
  });

  // The pilot has not said what they will fly it at, so nothing here can say they are clear.
  test('a leg with no planned altitude is a warning, not a verdict', async ({ page }) => {
    await boot(page);
    const got = await page.evaluate((args) => routeCheckFindings(Object.assign({}, args.route, {
      legs: [{}, {}, {}],
      airspace: [args.ctr],
      contains: (a, p) => routeCheckPointInRing(p, a.ring),
    })), { route: ROUTE, ctr: CTR });
    const f = got.findings.filter(x => x.kind === 'airspace');
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('warn');
    expect(f[0].noAltitude).toBe(true);
  });

  test('an area the route misses says nothing', async ({ page }) => {
    await boot(page);
    const away = Object.assign({}, CTR, {
      ring: [[30.0, 34.0], [30.0, 34.5], [30.5, 34.5], [30.5, 34.0]],
    });
    expect((await run(page, { airspace: [away] })).findings).toEqual([]);
  });
});

test.describe('NOTAMs, and when they are in force', () => {
  const closure = (start, end) => ({
    id: 'A1234/26', icao: 'LLIB', type: 'AD', text: 'AD CLOSED', start, end,
  });
  const iso = (ms) => new Date(ms).toISOString();

  test('a field closed while the flight is there is a finding', async ({ page }) => {
    await boot(page);
    const got = await run(page, { notams: [closure(iso(T0), iso(T0 + 2 * HOUR))] });
    const f = got.findings.filter(x => x.kind === 'notam');
    expect(f).toHaveLength(1);
    expect(f[0].onField).toBe(true);
    expect(f[0].icao).toBe('LLIB');
  });

  // The whole point of the check: a closure that lifts before the aeroplane gets there is
  // not a warning, it is just news.
  test('a closure that lifts before arrival is not a finding', async ({ page }) => {
    await boot(page);
    const got = await run(page, {
      notams: [closure(iso(T0 - 3 * HOUR), iso(T0 - 1 * HOUR))],
    });
    expect(got.findings.filter(x => x.kind === 'notam')).toEqual([]);
  });

  test('a closure that starts after the flight has gone is not a finding', async ({ page }) => {
    await boot(page);
    const got = await run(page, {
      notams: [closure(iso(T0 + 4 * HOUR), iso(T0 + 6 * HOUR))],
    });
    expect(got.findings.filter(x => x.kind === 'notam')).toEqual([]);
  });

  test('a NOTAM with no end is in force until it is cancelled', async ({ page }) => {
    await boot(page);
    const got = await run(page, { notams: [closure(iso(T0 - 9 * HOUR), null)] });
    expect(got.findings.filter(x => x.kind === 'notam')).toHaveLength(1);
  });

  // A circle on the ground the route flies through, rather than a field it names.
  test('a circle on the route is caught even between waypoints', async ({ page }) => {
    await boot(page);
    const mid = { lat: 32.575, lng: 35.125 };            // the middle of leg 2, no waypoint there
    const got = await run(page, {
      notams: [{
        id: 'C1952/26', icao: 'LLLL', text: 'PARACHUTE JUMPING EXERCISE',
        start: new Date(T0).toISOString(), end: new Date(T0 + 2 * HOUR).toISOString(),
        geom: { type: 'circle', lat: mid.lat, lng: mid.lng, radiusNm: 3 },
      }],
    });
    const f = got.findings.filter(x => x.kind === 'notam');
    expect(f).toHaveLength(1);
    expect(f[0].leg).toBe(1);
    expect(f[0].onField).toBe(false);
  });

  test('a circle nowhere near the route says nothing', async ({ page }) => {
    await boot(page);
    const got = await run(page, {
      notams: [{
        id: 'X/26', icao: 'LLLL', text: 'FAR AWAY',
        start: new Date(T0).toISOString(), end: new Date(T0 + 2 * HOUR).toISOString(),
        geom: { type: 'circle', lat: 29.5, lng: 34.9, radiusNm: 3 },
      }],
    });
    expect(got.findings).toEqual([]);
  });
});

test.describe('the weather the significant-weather chart draws, as data', () => {
  // The shape the SIGMET feed actually publishes: a ring, a band, epoch seconds.
  const ts = (ms) => Math.round(ms / 1000);
  const TS = {
    hazard: 'TS', qualifier: 'EMBD', base: null, top: 34000,
    validFrom: ts(T0), validTo: ts(T0 + 4 * HOUR),
    coords: [[32.4, 34.9], [32.4, 35.4], [32.8, 35.4], [32.8, 34.9]],
  };

  test('a hazard crossed inside its band while in force is a finding', async ({ page }) => {
    await boot(page);
    const f = (await run(page, { hazards: [TS] })).findings.filter(x => x.kind === 'hazard');
    expect(f).toHaveLength(1);
    expect(f[0].hazard).toBe('TS');
    expect(f[0].qualifier).toBe('EMBD');
  });

  test('a hazard that has expired is not a finding', async ({ page }) => {
    await boot(page);
    const old = Object.assign({}, TS, { validFrom: ts(T0 - 6 * HOUR), validTo: ts(T0 - 4 * HOUR) });
    expect((await run(page, { hazards: [old] })).findings).toEqual([]);
  });

  // A band the route passes under: the chart draws it, the flight never enters it.
  test('a hazard the route flies under is not a finding', async ({ page }) => {
    await boot(page);
    const high = Object.assign({}, TS, { base: 10000, top: 34000 });
    expect((await run(page, { hazards: [high] })).findings).toEqual([]);
  });
});

test.describe('ceiling', () => {
  const station = (icao, clouds) => ({ icao, clouds });

  test('a broken layer below a planned leg is a finding', async ({ page }) => {
    await boot(page);
    const got = await run(page, {
      wx: [station('LLIB', [{ cover: 'BKN', base: 1800 }])],
    });
    const f = got.findings.filter(x => x.kind === 'ceiling');
    expect(f).toHaveLength(1);
    expect(f[0].ceilingFt).toBe(1800);
    expect(f[0].altFt).toBe(3000);
  });

  // Few and scattered are not a ceiling -- that is the definition, and calling them one would
  // cry wolf on an ordinary fair-weather day.
  test('scattered is not a ceiling', async ({ page }) => {
    await boot(page);
    const got = await run(page, {
      wx: [station('LLIB', [{ cover: 'FEW', base: 1200 }, { cover: 'SCT', base: 1500 }])],
    });
    expect(got.findings.filter(x => x.kind === 'ceiling')).toEqual([]);
  });

  test('a ceiling above every planned leg is not a finding', async ({ page }) => {
    await boot(page);
    const got = await run(page, { wx: [station('LLIB', [{ cover: 'OVC', base: 6000 }])] });
    expect(got.findings.filter(x => x.kind === 'ceiling')).toEqual([]);
  });

  test('a station that is not on this route is ignored', async ({ page }) => {
    await boot(page);
    const got = await run(page, { wx: [station('LLER', [{ cover: 'OVC', base: 500 }])] });
    expect(got.findings).toEqual([]);
  });

  test('the lowest broken layer is the ceiling', async ({ page }) => {
    await boot(page);
    const got = await run(page, {
      wx: [station('LLIB', [{ cover: 'OVC', base: 4000 }, { cover: 'BKN', base: 900 }])],
    });
    expect(got.findings.find(x => x.kind === 'ceiling').ceilingFt).toBe(900);
  });
});

// A stop before a warning, and earlier legs before later ones: the order a pilot reads.
test('the findings come out in the order they matter', async ({ page }) => {
  await boot(page);
  const got = await run(page, {
    airspace: [{
      name: 'CTR', lowerFt: 0, upperFt: 4500,
      ring: [[32.4, 34.9], [32.4, 35.4], [32.8, 35.4], [32.8, 34.9]],
    }],
    notams: [{
      id: 'A1/26', icao: 'LLIB', text: 'AD CLOSED',
      start: new Date(T0).toISOString(), end: new Date(T0 + 4 * HOUR).toISOString(),
    }],
    wx: [{ icao: 'LLIB', clouds: [{ cover: 'BKN', base: 1200 }] }],
    hazards: [],
  });
  expect(got.findings[0].severity).toBe('stop');
  expect(got.findings.map(f => f.kind)).toContain('notam');
  expect(got.findings.map(f => f.kind)).toContain('ceiling');
});

// The panel itself: the control a pilot presses, and what it says when the feeds answer.
test.describe('the panel', () => {
  async function app(page) {
    await page.addInitScript(() => {
      try {
        for (const s of ['build', 'view', 'display', 'charts', 'export', 'print']) {
          localStorage.setItem('navaid.sec.' + s, '1');
        }
      } catch (e) {}
    });
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => !!(window.NavAid && NavAid.routeCheck)
      && typeof draw === 'function');
    await page.evaluate(() => { if (window.clearBootLoading) clearBootLoading(); });
  }

  const drawRoute = (page) => page.evaluate(() => {
    state.waypoints = [
      { name: 'LLHZ', lat: 32.18, lng: 34.83 },
      { name: 'BAZRA', lat: 32.45, lng: 35.00 },
      { name: 'LLIB', lat: 32.98, lng: 35.57 },
    ];
    syncLegs();
    for (const l of state.legs) { l.inboundAltitude = 3000; l.flightSpeed = 90; }
    draw();
  });

  test('the toolbar offers it', async ({ page }) => {
    await app(page);
    await expect(page.locator('#route-check-btn')).toHaveText('✓ Route check');
  });

  // Nothing to check is not the same as nothing found, and the panel must not claim the
  // second when it means the first.
  test('with no route it says so instead of opening a clear panel', async ({ page }) => {
    await app(page);
    const said = await page.evaluate(async () => {
      const spoken = [];
      const real = window.showToast;
      window.showToast = (m, o) => { spoken.push(String(m)); return real && real(m, o); };
      await NavAid.routeCheck.show();
      window.showToast = real;
      return spoken.join(' ');
    });
    expect(said).toMatch(/draw a route first/i);
    await expect(page.locator('.route-check-modal')).toHaveCount(0);
  });

  test('it opens, says which window it checked, and lists what it found', async ({ page }) => {
    await app(page);
    await drawRoute(page);
    // Stand in for the four feeds: this test is about the panel, not the network.
    await page.evaluate(() => {
      const now = Date.now();
      const iso = (ms) => new Date(ms).toISOString();
      window.loadNotam = async () => ([{
        id: 'A1234/26', icao: 'LLIB', text: 'AD CLOSED',
        start: iso(now - 3600000), end: iso(now + 6 * 3600000),
      }]);
      window.loadSigmets = async () => ([]);
      window.loadAirmets = async () => ([]);
      window.loadWxFile = async () => ({ stations: { LLIB: { metar: { clouds: [{ cover: 'BKN', base: 1500 }] } } } });
      window.airspace = [];
    });
    await NavAid_show(page);
    const panel = page.locator('.route-check-modal');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.route-check-when')).toContainText('Checked for');
    // The closure and the ceiling, both against the planned window.
    await expect(panel.locator('.route-check-item')).toHaveCount(2);
    await expect(panel).toContainText('A1234/26');
    await expect(panel).toContainText('AD CLOSED');
    await expect(panel).toContainText('ceiling 1,500 ft');
  });

  // "No NOTAMs affect this route" and "I could not ask about NOTAMs" are opposite answers.
  test('a source it could not read is named, not counted as clear', async ({ page }) => {
    await app(page);
    await drawRoute(page);
    await page.evaluate(() => {
      window.loadNotam = async () => null;              // the feed is down
      window.loadSigmets = async () => ([]);
      window.loadAirmets = async () => ([]);
      window.loadWxFile = async () => ({ stations: {} });
      window.airspace = [];
      window.notams = null;
    });
    await NavAid_show(page);
    const panel = page.locator('.route-check-modal');
    await expect(panel.locator('.route-check-unchecked')).toContainText('NOTAMs');
    await expect(panel.locator('.route-check-unchecked')).not.toContainText('airspace');
  });

  test('a clean plan says so plainly', async ({ page }) => {
    await app(page);
    await drawRoute(page);
    await page.evaluate(() => {
      window.loadNotam = async () => ([]);
      window.loadSigmets = async () => ([]);
      window.loadAirmets = async () => ([]);
      window.loadWxFile = async () => ({ stations: {} });
      window.airspace = [];
    });
    await NavAid_show(page);
    await expect(page.locator('.route-check-clear')).toBeVisible();
    await expect(page.locator('.route-check-item')).toHaveCount(0);
  });
});

// Opening the panel is async (four feeds), so every panel test waits the same way.
async function NavAid_show(page) {
  await page.evaluate(() => NavAid.routeCheck.show());
  await page.waitForSelector('.route-check-modal .route-check-when');
}

// METAR and TAF are POINTS, at aerodromes. The cloud that traps a VFR flight is usually the
// cloud between them, and no aerodrome report says anything about it. So the route is sampled
// along its own length and the air asked about at each point.
test.describe('cloud between the fields', () => {
  async function boot2(page) {
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof routeCheckSamplePoints === 'function');
  }

  test('the route is sampled every ten miles, ends included', async ({ page }) => {
    await boot2(page);
    const got = await page.evaluate(() => {
      const wps = [{ lat: 32.0, lng: 35.0 }, { lat: 32.5, lng: 35.0 }];   // 30 NM due north
      const pts = routeCheckSamplePoints(wps, 10);
      return {
        n: pts.length,
        legNm: Math.round(pts[0].legNm),
        gaps: pts.slice(1, -1).map((p, i) => Math.round(routeCheckNmBetween(pts[i], p))),
        lastIsEnd: pts[pts.length - 1].lat === 32.5,
      };
    });
    expect(got.legNm).toBe(30);
    expect(got.gaps.every(g => g === 10)).toBe(true);
    expect(got.lastIsEnd).toBe(true);
  });

  // A two-mile leg is still a place the aeroplane goes.
  test('a leg shorter than the step still gets a point', async ({ page }) => {
    await boot2(page);
    const n = await page.evaluate(() => routeCheckSamplePoints(
      [{ lat: 32.0, lng: 35.0 }, { lat: 32.03, lng: 35.0 }], 10).length);
    expect(n).toBe(2);                 // its start, and the route's end
  });

  // Cloud forms where the parcel cools to its dew point: about 400 ft per degree of spread.
  test('the base is the spread rule, to the precision the rule has', async ({ page }) => {
    await boot2(page);
    const got = await page.evaluate(() => ({
      ten: routeCheckCloudBaseAglFt(30, 20),
      tight: routeCheckCloudBaseAglFt(15.5, 15),
      saturated: routeCheckCloudBaseAglFt(12, 14),
      unknown: routeCheckCloudBaseAglFt(null, 14),
    }));
    expect(got.ten).toBe(4000);
    expect(got.tight).toBe(200);
    expect(got.saturated).toBe(0);     // on the deck
    expect(got.unknown).toBeNull();
  });

  const sample = (leg, baseAgl, cover, elevFt) =>
    ({ lat: 32.4, lng: 35.1, leg, baseFtAgl: baseAgl, lowCoverPct: cover, elevFt: elevFt || 0 });

  test('a broken layer below a planned leg is a finding, in feet AMSL', async ({ page }) => {
    await boot2(page);
    const f = await page.evaluate(() => routeCheckCloudFindings(
      [{ lat: 32.4, lng: 35.1, leg: 0, baseFtAgl: 1500, lowCoverPct: 80, elevFt: 900 }],
      [{ inboundAltitude: 3000 }], [{ from: 1, to: 2 }]));
    expect(f).toHaveLength(1);
    expect(f[0].baseFtAmsl).toBe(2400);        // 1,500 above 900 ft of ground
    expect(f[0].groundFt).toBe(900);
    expect(f[0].estimated).toBe(true);
  });

  // Broken starts at five eighths. Below that there is a layer, but there is also a way through.
  test('scattered cover is not a ceiling', async ({ page }) => {
    await boot2(page);
    const f = await page.evaluate((s) => routeCheckCloudFindings(
      [s], [{ inboundAltitude: 3000 }], []), sample(0, 1200, 40));
    expect(f).toEqual([]);
  });

  test('a base above the planned leg is not a finding', async ({ page }) => {
    await boot2(page);
    const f = await page.evaluate((s) => routeCheckCloudFindings(
      [s], [{ inboundAltitude: 3000 }], []), sample(0, 6000, 90));
    expect(f).toEqual([]);
  });

  // Nine rows saying the same thing is a panel nobody reads.
  test('one finding per leg, at its worst point', async ({ page }) => {
    await boot2(page);
    const f = await page.evaluate(() => routeCheckCloudFindings([
      { lat: 32.1, lng: 35, leg: 0, baseFtAgl: 2500, lowCoverPct: 70, elevFt: 0 },
      { lat: 32.2, lng: 35, leg: 0, baseFtAgl: 1100, lowCoverPct: 90, elevFt: 0 },
      { lat: 32.3, lng: 35, leg: 0, baseFtAgl: 2000, lowCoverPct: 70, elevFt: 0 },
      { lat: 32.4, lng: 35, leg: 1, baseFtAgl: 1800, lowCoverPct: 75, elevFt: 0 },
    ], [{ inboundAltitude: 3000 }, { inboundAltitude: 3000 }], []));
    expect(f).toHaveLength(2);
    expect(f.find(x => x.leg === 0).baseFtAmsl).toBe(1100);
    expect(f.find(x => x.leg === 0).coverPct).toBe(90);
  });

  test('no cloud data is named, not counted as clear', async ({ page }) => {
    await boot2(page);
    const got = await page.evaluate(() => routeCheckFindings({
      waypoints: [{ name: 'A', lat: 32, lng: 35 }, { name: 'B', lat: 32.5, lng: 35 }],
      legs: [{ inboundAltitude: 3000 }],
      legTimesH: [0.5], departAtMs: Date.now(),
      airspace: [], notams: [], hazards: [], wx: [],
    }));
    expect(got.unchecked).toEqual(['cloud']);
  });

  // It is a spread rule on a forecast, not a report, and the row has to say so every time.
  test('the panel calls it an estimate and shows the cover it is based on', async ({ page }) => {
    await boot2(page);
    await page.waitForFunction(() => !!(window.NavAid && NavAid.routeCheck));
    const parts = await page.evaluate(() => NavAid.routeCheck.lineFor({
      kind: 'cloudbase', severity: 'warn', leg: 0,
      baseFtAmsl: 2400, baseFtAgl: 1500, groundFt: 900, coverPct: 85, altFt: 3000,
      from: Date.UTC(2026, 8, 16, 8, 0), to: Date.UTC(2026, 8, 16, 8, 30),
    }));
    expect(parts.head).toMatch(/Estimated cloud base/);
    expect(parts.head).toContain('2,400 ft');
    expect(parts.head).toContain('AGL 1,500 ft');
    expect(parts.detail).toContain('85%');
    expect(parts.when).toBe('08:00–08:30Z');
  });
});

// Reported with a screenshot of a real route: nine findings, the last of them hanging off the
// bottom of the window and over the map, with no scrollbar and no sign there was more. The
// panel had no scroller of its own -- the same mistake the planning form's header made.
test.describe('a panel full of findings', () => {
  async function loaded(page, count, text) {
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => !!(window.NavAid && NavAid.routeCheck)
      && typeof draw === 'function');
    await page.evaluate(({ n, body }) => {
      clearBootLoading();
      state.waypoints = [{ name: 'LLHZ', lat: 32.18, lng: 34.83 },
        { name: 'LLIB', lat: 32.98, lng: 35.57 }];
      syncLegs();
      for (const l of state.legs) { l.inboundAltitude = 3000; l.flightSpeed = 90; }
      draw();
      const now = Date.now(), iso = (ms) => new Date(ms).toISOString();
      window.airspace = [];
      window.loadNotam = async () => Array.from({ length: n }, (_, k) => ({
        id: 'C' + (1900 + k) + '/26', icao: 'LLIB', text: body,
        start: iso(now - 3600000), end: iso(now + 6 * 3600000),
      }));
      window.loadSigmets = async () => ([]);
      window.loadAirmets = async () => ([]);
      window.loadWxFile = async () => ({ stations: {} });
      window.fetch = async () => { throw new Error('offline'); };
    }, { n: count, body: text });
    await page.evaluate(() => NavAid.routeCheck.show());
    await page.waitForSelector('.route-check-item');
  }

  const REAL = 'UAS/UAV ACT WILL TAKE PLACE AT OR-AKIVA INDUSTRY AREA. AN AREA BTN THE FLW PSN '
    + 'CLSD FM GND UP TO 500FT AMSL N323122E0345511 N323119E0345512. CTN ADZ.';

  test('the list scrolls and the window does not', async ({ page }) => {
    await loaded(page, 9, REAL);
    const got = await page.evaluate(() => {
      const box = document.querySelector('.route-check-modal');
      const body = document.querySelector('.route-check-body');
      return {
        bodyScrolls: body.scrollHeight > body.clientHeight + 1,
        boxScrolls: box.scrollHeight > box.clientHeight + 1,
        boxOverflowY: getComputedStyle(box).overflowY,
      };
    });
    expect(got.bodyScrolls, 'there is more than fits, and it is the body that holds it').toBe(true);
    expect(got.boxScrolls).toBe(false);
    expect(got.boxOverflowY).toBe('hidden');
  });

  test('the last finding can be reached, not just clipped', async ({ page }) => {
    await loaded(page, 9, REAL);
    const reach = await page.evaluate(async () => {
      const box = document.querySelector('.route-check-modal');
      const body = document.querySelector('.route-check-body');
      const items = document.querySelectorAll('.route-check-item');
      const last = items[items.length - 1];
      const before = last.getBoundingClientRect().bottom <= box.getBoundingClientRect().bottom;
      body.scrollTop = body.scrollHeight;
      await new Promise(r => setTimeout(r, 50));
      return {
        before,
        after: last.getBoundingClientRect().bottom <= box.getBoundingClientRect().bottom + 1,
      };
    });
    expect(reach.before, 'nine of them do not fit at once').toBe(false);
    expect(reach.after, 'and scrolling brings the last one inside the window').toBe(true);
  });

  // The title, its X, AND the window line stay put while the findings move under them. The
  // window is what every finding below is relative to -- a NOTAM valid 13:00-14:00 means
  // nothing without it -- so it was the worst line to let scroll away, and it did: it was the
  // first child of the scroller until it was moved out.
  test('the header and the window line do not scroll away with the list', async ({ page }) => {
    await loaded(page, 9, REAL);
    const pos = () => page.evaluate(() => {
      const x = document.querySelector('.route-check-modal .modal-close-x');
      const when = document.querySelector('.route-check-when');
      const box = document.querySelector('.route-check-modal');
      return {
        x: x ? Math.round(x.getBoundingClientRect().top) : null,
        when: when ? Math.round(when.getBoundingClientRect().top) : null,
        whenInside: when
          ? when.getBoundingClientRect().top >= box.getBoundingClientRect().top : null,
        whenText: when ? when.textContent : '',
      };
    });
    const before = await pos();
    expect(before.whenText).toMatch(/Checked for/);
    await page.evaluate(() => {
      const body = document.querySelector('.route-check-body');
      body.scrollTop = body.scrollHeight;
    });
    const after = await pos();
    expect(after.x).toBe(before.x);
    expect(after.when, 'the window line holds its place').toBe(before.when);
    expect(after.whenInside).toBe(true);
    // ...and it is not in the scroller at all, which is what makes that true at any scroll.
    expect(await page.evaluate(() =>
      !document.querySelector('.route-check-body').contains(
        document.querySelector('.route-check-when')))).toBe(true);
  });

  // NOTAM text is somebody else's, and it arrives with coordinate strings that have no break
  // opportunity in them.
  test('an unbreakable word breaks rather than widening the panel', async ({ page }) => {
    await loaded(page, 1, 'CLSD SEE N323122E0345511N323119E0345512N323119E0345515N323123E0345514REFAIPPARTA17PAGE10');
    const got = await page.evaluate(() => {
      const box = document.querySelector('.route-check-modal');
      const detail = document.querySelector('.route-check-detail');
      return {
        modalW: Math.round(box.getBoundingClientRect().width),
        detailRight: Math.round(detail.getBoundingClientRect().right),
        boxRight: Math.round(box.getBoundingClientRect().right),
        viewport: innerWidth,
      };
    });
    expect(got.detailRight).toBeLessThanOrEqual(got.boxRight);
    expect(got.modalW).toBeLessThanOrEqual(got.viewport);
  });

  // `ch` scales with the font, so a zoomed page took the panel as wide as the screen.
  test('a large base font cannot widen the panel past its cap', async ({ page }) => {
    await loaded(page, 3, REAL);
    const got = await page.evaluate(() => {
      const box = document.querySelector('.route-check-modal');
      const normal = Math.round(box.getBoundingClientRect().width);
      document.documentElement.style.fontSize = '32px';
      const zoomed = Math.round(box.getBoundingClientRect().width);
      document.documentElement.style.fontSize = '';
      return { normal, zoomed };
    });
    expect(got.zoomed).toBeLessThanOrEqual(got.normal + 2);
  });
});
