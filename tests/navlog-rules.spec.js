// @ts-check
// The nav log's rules, one at a time -- the cases a single reference sheet does not reach.
// The sheet itself is tests/navlog-golden.spec.js; this is what happens either side of it.
const { test, expect } = require('./_setup');

const call = (page, fn) => page.evaluate(fn);

test.beforeEach(async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof navLogRows === 'function');
});

test('ISA, density altitude and TAS at the standard reference points', async ({ page }) => {
  const got = await call(page, () => ({
    isaSl: isaTempAtPaC(0),
    isa5: Math.round(isaTempAtPaC(5000) * 100) / 100,
    // A standard day: density altitude IS the pressure altitude.
    standard: Math.round(densityAltFromPaFt(5000, isaTempAtPaC(5000))),
    // Twenty degrees above standard: 120 ft per degree.
    hot: Math.round(densityAltFromPaFt(5000, isaTempAtPaC(5000) + 20)),
    // On a standard day at sea level, TAS is CAS.
    tasSl: Math.round(tasFromCas(100, 0, 15) * 10) / 10,
    // TAS never comes back below CAS in air thinner than sea level.
    tasUp: tasFromCas(100, 8000, 0) > 100,
    // Nothing to work with is null, not a plausible-looking number.
    noCas: tasFromCas(0, 5000, 10),
    noTemp: tasFromCas(100, 5000, null),
  }));
  expect(got.isaSl).toBe(15);
  expect(got.isa5).toBe(5.1);
  expect(got.standard).toBe(5000);
  expect(got.hot).toBe(7400);
  expect(got.tasSl).toBe(100);
  expect(got.tasUp).toBe(true);
  expect(got.noCas).toBeNull();
  expect(got.noTemp).toBeNull();
});

// The app already publishes a densityAltFt() that means something else -- field elevation plus a
// QNH, for the airfield panel. A collision between the two signatures reads as a silent null, so
// the nav log's versions are named for what they take.
test('the nav log\'s altitude maths does not collide with the airfield panel\'s', async ({ page }) => {
  const got = await call(page, () => ({
    navlog: Math.round(densityAltFromPaFt(6000, 2)),
    panelTakesThreeArgs: typeof window.densityAltFt === 'function'
      && window.densityAltFt.length === 3,
  }));
  expect(got.navlog).toBe(5866);   // 6000 + 120 * (2 - 3.12)
  expect(got.panelTakesThreeArgs).toBe(true);
});

test('the segment altitudes are measured from the field, not from sea level', async ({ page }) => {
  const got = await call(page, () => ({
    climb: Math.round(navLogSegmentAltFt('climb', 100, 6000)),
    descent: Math.round(navLogSegmentAltFt('descent', 900, 6000)),
    cruise: navLogSegmentAltFt('cruise', 100, 6000),
    // A field higher than the cruise level is a route with no climb in it, not a negative one.
    odd: Math.round(navLogSegmentAltFt('climb', 8000, 6000)),
  }));
  expect(got.climb).toBe(4033);
  expect(got.descent).toBe(3450);
  expect(got.cruise).toBe(6000);
  expect(got.odd).toBe(6667);
});

test('the met table is read at its nearest row, and ties go down', async ({ page }) => {
  const got = await call(page, () => {
    const met = [{ alt: 3000, dir: 290, kt: 17, tempC: 8 }, { alt: 4000, dir: 300, kt: 20, tempC: 6 }];
    return {
      low: navLogMetRow(met, 3100).alt,
      high: navLogMetRow(met, 3900).alt,
      tie: navLogMetRow(met, 3500).alt,          // exactly between: the lower row
      outside: navLogMetRow(met, 12000).alt,      // no extrapolation, the nearest row stands
      empty: navLogMetRow([], 3000),
    };
  });
  expect(got.low).toBe(3000);
  expect(got.high).toBe(4000);
  expect(got.tie).toBe(3000);
  expect(got.outside).toBe(4000);
  expect(got.empty).toBeNull();
});

test('the compass card is read around the compass, not along a number line', async ({ page }) => {
  const got = await call(page, () => {
    const card = [{ mh: 0, ch: 358 }, { mh: 30, ch: 27 }, { mh: 330, ch: 332 }];
    return {
      // 355 is five degrees from the 000 entry and twenty-five from the 330 one.
      nearZero: navLogDeviation(card, 355),
      at340: navLogDeviation(card, 340),
      at40: navLogDeviation(card, 40),
      noCard: navLogDeviation([], 100),
    };
  });
  expect(got.nearZero).toBe(-2);
  expect(got.at340).toBe(2);
  expect(got.at40).toBe(-3);
  expect(got.noCard).toBe(0);
});

test('drift takes the side the wind pushes, either way', async ({ page }) => {
  const got = await call(page, () => {
    const card = [];
    const left = navLogHeadings(0, 100, { dir: 270, speed: 20 }, 0, card);   // wind from the left
    const right = navLogHeadings(0, 100, { dir: 90, speed: 20 }, 0, card);   // from the right
    const calm = navLogHeadings(45, 100, null, 0, card);
    return {
      leftSide: left.driftSide, leftTh: Math.round(left.trueHeadingDeg),
      rightSide: right.driftSide, rightTh: Math.round(right.trueHeadingDeg),
      calmSide: calm.driftSide, calmTh: Math.round(calm.trueHeadingDeg), calmGs: calm.groundSpeedKt,
    };
  });
  // A wind from the left pushes you right, so you hold left of track: 348, not 012.
  expect(got.leftSide).toBe('R');
  expect(got.leftTh).toBe(348);
  expect(got.rightSide).toBe('L');
  expect(got.rightTh).toBe(12);
  // Calm: the aeroplane flies its track at its airspeed. An answer, not a refusal.
  expect(got.calmSide).toBe('');
  expect(got.calmTh).toBe(45);
  expect(got.calmGs).toBe(100);
});

test('a crosswind the aeroplane cannot hold is said, not printed as a number', async ({ page }) => {
  const got = await call(page, () =>
    navLogHeadings(0, 20, { dir: 90, speed: 60 }, 0, []));
  expect(got.unflyable).toBe(true);
});

// The reference sheet climbs inside its first leg. A slower climb, or a shorter first leg, does
// not stop at the waypoint -- it carries on down the next track, and the sheet has to show that
// rather than put the top of climb somewhere the aeroplane will not be.
test('a climb that outlasts the first leg is split at the waypoint', async ({ page }) => {
  const got = await call(page, () => navLogRows({
    waypoints: [
      { name: 'A', lat: 32.0, lng: 34.9 },
      { name: 'B', lat: 32.1, lng: 34.9 },        // six miles
      { name: 'C', lat: 33.0, lng: 34.9 },
    ],
    depElevFt: 0, destElevFt: 0, cruiseAltFt: 8000,
    cas: { climb: 70, cruise: 90, descent: 100 },
    rates: { climbFpm: 300, descentFpm: 1000 },   // a long, slow climb
    fuel: { climbGal: 9, cruiseGph: 8 },
    variationDeg: 4, met: [], deviation: [],
  }).map(r => ({ kind: r.kind, from: r.from, to: r.to,
                 dist: Math.round(r.distNm * 10) / 10, fuel: Math.round(r.fuelGal * 100) / 100 })));
  const climbs = got.filter(r => r.kind === 'climb');
  expect(climbs.length).toBeGreaterThan(1);
  expect(climbs[0]).toMatchObject({ from: 'A', to: 'B' });
  expect(climbs[climbs.length - 1].to).toBe('TOC');
  // The flat climb allowance is split across them, so the cumulative column still adds up.
  const climbFuel = climbs.reduce((sum, r) => sum + r.fuel, 0);
  expect(climbFuel).toBeCloseTo(9, 1);
});

test('a route with no wind and no card still produces a whole sheet', async ({ page }) => {
  const got = await call(page, () => navLogRows({
    waypoints: [{ name: 'A', lat: 32.0, lng: 34.9 }, { name: 'B', lat: 32.5, lng: 35.2 }],
    depElevFt: 100, destElevFt: 200, cruiseAltFt: 4500,
    cas: { climb: 70, cruise: 95, descent: 100 },
    rates: { climbFpm: 700, descentFpm: 500 },
    fuel: { climbGal: 5, cruiseGph: 9 },
    variationDeg: 4, met: [], deviation: [],
  }).map(r => ({ kind: r.kind, met: r.metSource, temp: Math.round(r.tempC * 10) / 10,
                 gs: Math.round(r.groundSpeedKt), ch: Math.round(r.compassHeadingDeg) })));
  expect(got.map(r => r.kind)).toEqual(['climb', 'cruise', 'descent']);
  // With nothing typed and nothing fetched, the air is ISA and the row says where that came from.
  for (const row of got) {
    expect(row.met).toBe('isa');
    expect(row.gs).toBeGreaterThan(0);
    expect(Number.isFinite(row.ch)).toBe(true);
  }
});

// "Typed wins" is the rule; this is what happens where the typed table has a hole.
test('where the table is silent the app\'s own wind answers, and the row says so', async ({ page }) => {
  const got = await call(page, () => navLogRows({
    waypoints: [{ name: 'A', lat: 32.0, lng: 34.9 }, { name: 'B', lat: 32.6, lng: 35.2 }],
    depElevFt: 0, destElevFt: 0, cruiseAltFt: 5000,
    cas: { climb: 70, cruise: 90, descent: 100 },
    rates: { climbFpm: 800, descentFpm: 1000 },
    fuel: { climbGal: 7, cruiseGph: 8 },
    variationDeg: 4,
    met: [{ alt: 5000, dir: 300, kt: 22, tempC: 4 }],    // cruise only: the climb has no row
    deviation: [],
    windFor: () => ({ dir: 270, speed: 10 }),
    fallbackTempC: 12,
  }).map(r => ({ kind: r.kind, src: r.metSource, dir: r.wind && r.wind.dir, temp: r.tempC })));
  const cruise = got.find(r => r.kind === 'cruise');
  expect(cruise).toMatchObject({ src: 'table', dir: 300, temp: 4 });
  // 3333 ft is nearer the 5,000 row than to nothing at all -- the table has ONE row, so it wins
  // everywhere. The fallback is for a table with no rows at all, or none within reach.
  expect(got.every(r => r.src === 'table')).toBe(true);
});

// Found in review, not in flying: three ways the sheet used to come up short and say nothing.

// You cannot come down from a level you never reached. On a short route with a high planned
// level and a slow descent, the descent used to consume every leg before the climb was laid
// down, and the sheet came out as one descent row from an altitude the aeroplane never saw.
test('the climb is laid down before the descent, whatever the route is', async ({ page }) => {
  const rows = await call(page, () => navLogRows({
    waypoints: [{ name: 'A', lat: 32.0, lng: 34.9 }, { name: 'B', lat: 32.08, lng: 34.95 }],
    depElevFt: 100, destElevFt: 100, cruiseAltFt: 9500,
    cas: { climb: 70, cruise: 90, descent: 100 },
    rates: { climbFpm: 500, descentFpm: 300 },      // five miles, 9,400 ft, 300 fpm down
    fuel: { climbGal: 7, cruiseGph: 8 }, variationDeg: 4, met: [], deviation: [],
  }).map(r => ({ kind: r.kind, dist: Math.round(r.distNm * 10) / 10, clipped: !!r.descentClipped })));
  expect(rows[0].kind).toBe('climb');
  expect(rows[0].dist).toBeGreaterThan(0);
  // ...and the descent takes whatever ground is left -- here, none at all, because the climb
  // used the route up. The sheet says the descent did not fit rather than inventing distance.
  const last = rows[rows.length - 1];
  expect(last.clipped, JSON.stringify(rows)).toBe(true);
});

// A crosswind bigger than the airspeed has no solution. The row used to be dropped, leaving a
// sheet that was simply short and said nothing about why.
test('a segment that cannot be flown is a row that says so', async ({ page }) => {
  const rows = await call(page, () => navLogRows({
    waypoints: [{ name: 'A', lat: 32.0, lng: 34.9 }, { name: 'B', lat: 32.4, lng: 35.1 }],
    depElevFt: 100, destElevFt: 100, cruiseAltFt: 3000,
    cas: { climb: 70, cruise: 90, descent: 100 },
    rates: { climbFpm: 500, descentFpm: 500 },
    fuel: { climbGal: 7, cruiseGph: 8 }, variationDeg: 4, deviation: [],
    met: [{ alt: 2000, dir: 90, kt: 200, tempC: 10 }],
  }).map(r => ({ kind: r.kind, unflyable: !!r.unflyable })));
  expect(rows.some(r => r.unflyable), JSON.stringify(rows)).toBe(true);
  expect(rows.some(r => r.kind === 'climb')).toBe(true);
});

// No rate of climb typed, but a height to gain: the sheet used to start at cruise level as if
// the aeroplane had teleported there.
test('a climb with no rate is a row that says so, not a silent teleport', async ({ page }) => {
  const rows = await call(page, () => navLogRows({
    waypoints: [{ name: 'A', lat: 32.0, lng: 34.9 }, { name: 'B', lat: 32.4, lng: 35.1 }],
    depElevFt: 100, destElevFt: 100, cruiseAltFt: 3000,
    cas: { climb: 70, cruise: 90, descent: 100 },
    rates: { climbFpm: 0, descentFpm: 500 },
    fuel: { climbGal: 7, cruiseGph: 8 }, variationDeg: 4, met: [], deviation: [],
  }).map(r => ({ kind: r.kind, unflyable: !!r.unflyable, noRate: !!r.noRate })));
  expect(rows[0]).toMatchObject({ kind: 'climb', unflyable: true, noRate: true });
});
