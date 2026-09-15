// @ts-check
// The nav log, checked against a real exercise's published answers.
//
// The flight plan is zero-wind on purpose. This is the other document -- the one a CVFR written
// exercise asks for, where the marks are in the arithmetic between an indicated airspeed and a
// compass heading. Every rule in navLogRows() is here because it reproduces this sheet; where a
// plausible alternative exists (interpolating the compass card, interpolating the met table) it
// is here because it does NOT.
//
// Herzliya (100') -> N32°30 E035°00 -> N32°40 E035°30 -> N32°58 E035°10 -> Rosh Pina (900').
// Climb 70 KCAS at 800 fpm, 7 USG. Cruise 6,000' at 90 KCAS, 8 USG/h. Descent 100 KCAS at
// 1000 fpm, cruise flow. Variation 4E, and the compass card and met table below.
const { test, expect } = require('./_setup');

const ROUTE = {
  waypoints: [
    { name: 'הרצליה', lat: 32.1797, lng: 34.8347 },   // LLHZ
    { name: 'א', lat: 32.5, lng: 35.0 },
    { name: 'ב', lat: 32 + 40 / 60, lng: 35.5 },
    { name: 'ג', lat: 32 + 58 / 60, lng: 35 + 10 / 60 },
    { name: 'ראש פינה', lat: 32.9811, lng: 35.5719 },  // LLIB
  ],
  depElevFt: 100,
  destElevFt: 900,
  cruiseAltFt: 6000,
  cas: { climb: 70, cruise: 90, descent: 100 },
  rates: { climbFpm: 800, descentFpm: 1000 },
  fuel: { climbGal: 7, cruiseGph: 8 },
  variationDeg: 4,                                   // 4E, as the sheet states
  met: [
    { alt: 2000, dir: 315, kt: 17, tempC: 10 },
    { alt: 3000, dir: 290, kt: 17, tempC: 8 },
    { alt: 4000, dir: 300, kt: 20, tempC: 6 },
    { alt: 5000, dir: 300, kt: 22, tempC: 4 },
    { alt: 6000, dir: 320, kt: 25, tempC: 2 },
    { alt: 7000, dir: 325, kt: 27, tempC: 0 },
  ],
  deviation: [
    { mh: 0, ch: 358 }, { mh: 30, ch: 27 }, { mh: 60, ch: 59 },
    { mh: 90, ch: 90 }, { mh: 120, ch: 122 }, { mh: 150, ch: 152 },
    { mh: 180, ch: 180 }, { mh: 210, ch: 209 }, { mh: 240, ch: 241 },
    { mh: 270, ch: 272 }, { mh: 300, ch: 300 }, { mh: 330, ch: 332 },
  ],
};

async function rows(page, route) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof navLogRows === 'function');
  return page.evaluate((r) => navLogRows(r).map(row => ({
    kind: row.kind,
    from: row.from,
    to: row.to,
    cas: row.casKt,
    pa: Math.round(row.pressureAltFt),
    temp: row.tempC,
    tas: Math.round(row.tasKt * 10) / 10,
    windDir: row.wind && row.wind.dir,
    windKt: row.wind && row.wind.speed,
    track: row.trackShownDeg,
    drift: row.driftShownDeg + row.driftSide,
    th: Math.round(row.trueHeadingDeg),
    mh: Math.round(row.magneticHeadingDeg),
    dev: row.deviationDeg,
    ch: Math.round(row.compassHeadingDeg),
    gs: Math.round(row.groundSpeedKt * 10) / 10,
    dist: Math.round(row.distNm * 10) / 10,
    min: Math.round(row.timeH * 600) / 10,
    cumMin: Math.round(row.cumTimeH * 600) / 10,
    fuel: Math.round(row.fuelGal * 10) / 10,
    cumFuel: Math.round(row.cumFuelGal * 10) / 10,
  })), route);
}

test('the sheet reproduces: six rows, climb through descent', async ({ page }) => {
  const got = await rows(page, ROUTE);
  expect(got).toHaveLength(6);
  expect(got.map(r => r.kind)).toEqual(['climb', 'cruise', 'cruise', 'cruise', 'cruise', 'descent']);
  expect(got.map(r => [r.from, r.to])).toEqual([
    ['הרצליה', 'TOC'], ['TOC', 'א'], ['א', 'ב'], ['ב', 'ג'], ['ג', 'TOD'], ['TOD', 'ראש פינה'],
  ]);
});

// The two rules that make a climb and a descent row computable at all.
test('the climb reads its air two thirds up, the descent half way down', async ({ page }) => {
  const got = await rows(page, ROUTE);
  expect(got[0].pa).toBe(4033);        // 100 + 2/3 * 5900
  expect(got[5].pa).toBe(3450);        // 900 + 1/2 * 5100
  // ...and each takes the NEAREST met row, without interpolating between two.
  expect([got[0].temp, got[0].windDir, got[0].windKt]).toEqual([6, 300, 20]);    // the 4,000 row
  expect([got[5].temp, got[5].windDir, got[5].windKt]).toEqual([8, 290, 17]);    // the 3,000 row
  expect([got[1].temp, got[1].windDir, got[1].windKt]).toEqual([2, 320, 25]);    // cruise, 6,000
});

test('true airspeed comes out at the sheet\'s figures', async ({ page }) => {
  const got = await rows(page, ROUTE);
  expect(got[0].tas).toBe(74.2);       // 70 KCAS at 4033' / +6
  expect(got[1].tas).toBe(98.2);       // 90 KCAS at 6,000' / +2
  expect(got[5].tas).toBe(105.2);      // 100 KCAS at 3450' / +8
});

// Drift is the side the wind pushes you; the heading is the other way. The published sheet says
// 15R with a true track of 024 and a true heading of 009 -- so the number printed is the drift,
// not the correction, and they have opposite signs.
test('drift is printed as the side the wind pushes, and the heading holds against it', async ({ page }) => {
  const got = await rows(page, ROUTE);
  expect(got[0].track).toBe(24);
  expect(got[0].drift).toMatch(/^1[56]R$/);        // the sheet's 15R; see the note below
  expect(got[0].th).toBeGreaterThanOrEqual(8);     // 009 on the sheet
  expect(got[0].th).toBeLessThanOrEqual(9);
  expect(got[0].gs).toBe(69.4);
});

// The rule that interpolation gets wrong: MH 050 takes the 060 entry's -1 and prints 049, where
// interpolating between the 030 and 060 entries would give 048.
test('the compass card is read at its nearest entry, not interpolated', async ({ page }) => {
  const got = await rows(page, ROUTE);
  expect([got[2].mh, got[2].dev, got[2].ch]).toEqual([50, -1, 49]);
  expect([got[3].mh, got[3].dev, got[3].ch]).toEqual([314, 0, 314]);
  expect(got[0].dev).toBe(-2);                     // MH 005 takes the 000 entry
});

// The whole sheet. Air, speed and geometry are asserted exactly; the heading columns are allowed
// a degree, because the published sheet was worked on a flight computer and does not agree with
// ITSELF there -- its last row reads 087 true track, 5R drift, 083 true heading, and 87 - 5 is 82.
// What is asserted exactly in those columns is that our own chain adds up: track - drift = true
// heading, minus variation = magnetic, plus the card's deviation = compass.
test('the whole sheet, cell by cell', async ({ page }) => {
  const got = await rows(page, ROUTE);
  const sheet = [
    // kind      from      to          cas  pa    temp tas    track drift th   mh   ch
    ['climb',   'הרצליה', 'TOC',       70,  4033, 6,   74.2,  24,  15,   9,   5,   3],
    ['cruise',  'TOC',    'א',         90,  6000, 2,   98.2,  24,  13,   11,  7,   5],
    ['cruise',  'א',      'ב',         90,  6000, 2,   98.2,  68,  14,   54,  50,  49],
    ['cruise',  'ב',      'ג',         90,  6000, 2,   98.2,  317, 1,    318, 314, 314],
    ['cruise',  'ג',      'TOD',       90,  6000, 2,   98.2,  87,  12,   75,  71,  70],
    ['descent', 'TOD',    'ראש פינה',  100, 3450, 8,   105.2, 87,  5,    83,  79,  79],
  ];
  const near = (mine, theirs, what) => {
    const off = Math.abs(((mine - theirs + 540) % 360) - 180);
    expect(off, what + ': ours ' + mine + ', the sheet ' + theirs).toBeLessThanOrEqual(1);
  };
  got.forEach((row, i) => {
    const [kind, from, to, cas, pa, temp, tas, track, drift, th, mh, ch] = sheet[i];
    const at = 'row ' + (i + 1) + ' ';
    expect([row.kind, row.from, row.to], at + 'identity').toEqual([kind, from, to]);
    expect([row.cas, row.pa, row.temp, row.tas], at + 'air').toEqual([cas, pa, temp, tas]);
    expect(row.track, at + 'track').toBe(track);
    near(parseInt(row.drift, 10), drift, at + 'drift');
    near(row.th, th, at + 'true heading');
    near(row.mh, mh, at + 'magnetic heading');
    near(row.ch, ch, at + 'compass heading');
    // Our own columns must add up exactly, whatever the sheet's flight computer did.
    const side = row.drift.slice(-1);
    const signed = side === 'R' ? -parseInt(row.drift, 10) : parseInt(row.drift, 10);
    expect((((row.track + signed) % 360) + 360) % 360, at + 'track - drift = true heading').toBe(row.th);
    expect((((row.th - ROUTE.variationDeg) % 360) + 360) % 360, at + 'true - variation = magnetic').toBe(row.mh);
    expect((((row.mh + row.dev) % 360) + 360) % 360, at + 'magnetic + deviation = compass').toBe(row.ch);
  });
});

test('distances, times and fuel run down the sheet', async ({ page }) => {
  const got = await rows(page, ROUTE);
  // The climb is bounded by time -- 5,900 ft at 800 fpm -- so its distance is what it makes good.
  expect(got[0].min).toBeCloseTo(7.4, 1);
  expect(got[0].dist).toBeCloseTo(8.5, 0);
  // The descent likewise: 5,100 ft at 1000 fpm.
  expect(got[5].min).toBeCloseTo(5.1, 1);
  expect(got[5].dist).toBeCloseTo(10.3, 0);
  // Fuel: a flat allowance for the climb, cruise flow for everything after it.
  expect(got[0].fuel).toBe(7);
  expect(got[0].gs).toBeGreaterThan(0);
  expect(got[5].fuel).toBeCloseTo(0.7, 1);
  // Cumulative columns add up, and the sheet's own total is about 62 minutes and 14.4 USG.
  expect(got[5].cumMin).toBeCloseTo(62.7, 0);
  expect(got[5].cumFuel).toBeCloseTo(14.4, 0);
  got.reduce((prev, row) => {
    expect(row.cumMin).toBeGreaterThanOrEqual(prev);
    return row.cumMin;
  }, 0);
});
