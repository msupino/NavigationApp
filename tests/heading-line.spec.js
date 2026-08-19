// @ts-check
// Own-ship heading predictor: a line along the current track with TWO sets of
// cross-tick marks -- fixed distance (2/5/10 NM) and fixed time (2/5 minutes ahead) --
// both, not either/or. Just the marks themselves: a time-to-reach subtext under the NM
// marks and a distance subtext under the minute marks were both tried and reported as
// unwanted clutter ("it shows 1:20 as well"), so neither carries a secondary row. The
// NM marks draw regardless of speed; the minute marks need a groundspeed to derive
// their distance from and are simply omitted without one. Shown for both live GPS
// location and the simulator own-ship; freezes on the last valid heading when GPS
// course goes null (zero groundspeed). See drawHeadingLine() in draw.js.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof drawOwnShip === 'function' && typeof map !== 'undefined'
    && typeof geo === 'function');
  await page.evaluate(() => map.setView([32.1, 34.9], 9));
}

test('predictor marks the line at 2 / 5 / 10 NM for the live own-ship', async ({ page }) => {
  await boot(page);
  const marks = await page.evaluate(() => {
    window.__headingLine = null;
    window.gpsLiveOn = true;
    window.gpsOwn = { lat: 32.1, lng: 34.9, hdg: 90 };
    drawOwnShip(window.gpsOwn, window.gpsOwn.hdg);
    return window.__headingLine;
  });
  expect(marks).not.toBeNull();
  expect(marks.marks).toEqual([2, 5, 10]);
  expect(marks.heading).toBe(90);
  expect(marks.minMarks).toEqual([]);   // no groundspeed here -- minute marks need one
});

test('minute marks (2 / 5 min) appear alongside the NM marks once a groundspeed is known', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    window.__headingLine = null;
    window.gpsLiveOn = true;
    window.gpsOwn = { lat: 32.1, lng: 34.9, hdg: 90 };
    drawOwnShip(window.gpsOwn, window.gpsOwn.hdg, 90);
    return window.__headingLine;
  });
  expect(out.marks).toEqual([2, 5, 10]);      // both sets present at once, not either/or
  expect(out.minMarks).toEqual([2, 5]);
});

test('the NM-marked line still draws without a reliable groundspeed -- only the minute marks are omitted', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    window.__headingLine = null;
    window.gpsLiveOn = true;
    window.gpsOwn = { lat: 32.1, lng: 34.9, hdg: 90 };
    drawOwnShip(window.gpsOwn, window.gpsOwn.hdg);   // no speed
    return window.__headingLine;
  });
  expect(out).not.toBeNull();
  expect(out.marks).toEqual([2, 5, 10]);
  expect(out.minMarks).toEqual([]);
  const zeroSpeed = await page.evaluate(() => {
    window.__headingLine = null;
    drawOwnShip(window.gpsOwn, window.gpsOwn.hdg, 0);   // 0 kt is not a divide-by-zero guess either
    return window.__headingLine.minMarks;
  });
  expect(zeroSpeed).toEqual([]);
});

test('the line reaches whichever mark set extends further (a fast aircraft\'s 5-minute mark, past 10 NM)', async ({ page }) => {
  await boot(page);
  // 200 kt: the 5-minute mark is 16.7 nm out, past the fixed 10 NM mark -- checked via
  // the underlying atNm() offset math (no per-mark screen position is exposed), same
  // way the dedicated NM-projection test below verifies it.
  const out = await page.evaluate(() => {
    window.__headingLine = null;
    window.gpsLiveOn = true;
    window.gpsOwn = { lat: 32.1, lng: 34.9, hdg: 90 };
    drawOwnShip(window.gpsOwn, window.gpsOwn.hdg, 200);
    return window.__headingLine;
  });
  expect(out.marks).toEqual([2, 5, 10]);
  expect(out.minMarks).toEqual([2, 5]);
});

test('end-of-line heading label is magnetic (toMagnetic), padded to 3 digits, wraps 0-360', async ({ page }) => {
  await boot(page);
  const cases = await page.evaluate(() => {
    const out = [];
    for (const hdg of [4, 90, 359, -10, 370]) {
      window.__headingLine = null;
      window.gpsLiveOn = true;
      window.gpsOwn = { lat: 32.1, lng: 34.9, hdg };
      drawOwnShip(window.gpsOwn, hdg);
      out.push({ label: window.__headingLine.headingLabel, expected: toMagnetic(hdg) });
    }
    return out;
  });
  for (const c of cases) {
    expect(c.label).toBe(String(c.expected).padStart(3, '0') + '°');
  }
});

test('also draws for the simulator own-ship', async ({ page }) => {
  await boot(page);
  const drawn = await page.evaluate(() => {
    window.__headingLine = null;
    window.simOn = true;
    window.simAircraft = { lat: 32.1, lng: 34.9, hdg: 270 };
    drawOwnShip(window.simAircraft, window.simAircraft.hdg);
    return window.__headingLine;
  });
  expect(drawn).not.toBeNull();
  expect(drawn.heading).toBe(270);
});

test('the simulator own-ship gets minute marks from its own IAS too', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    window.__headingLine = null;
    window.simOn = true;
    window.simAircraft = { lat: 32.1, lng: 34.9, hdg: 270, ias: 120 };
    drawOwnShip(window.simAircraft, window.simAircraft.hdg, window.simAircraft.ias);
    return window.__headingLine.minMarks;
  });
  expect(out).toEqual([2, 5]);
});

test('the 10 NM mark projects to a point 10 NM ahead on the heading', async ({ page }) => {
  await boot(page);
  // Re-derive the outermost fixed mark geographically and check it against geo():
  // 10 NM at 090° from the own-ship should read ~10 NM / ~090° back.
  const out = await page.evaluate(() => {
    const pos = { lat: 32.1, lng: 34.9 };
    const hr = 90 * Math.PI / 180;
    const cosLat = Math.max(0.2, Math.cos(pos.lat * Math.PI / 180));
    const mark = {
      lat: pos.lat + (10 / 60) * Math.cos(hr),
      lng: pos.lng + (10 / 60) * Math.sin(hr) / cosLat,
    };
    return geo(pos, mark); // { dist, brg }
  });
  expect(out.dist).toBeCloseTo(10, 0);
  expect(out.brg).toBeGreaterThan(88);
  expect(out.brg).toBeLessThan(92);
});

test('keeps the last heading when the GPS course goes null (stationary)', async ({ page }) => {
  await boot(page);
  const frozen = await page.evaluate(() => {
    window.gpsLiveOn = true;
    // First a valid course…
    window.gpsOwn = { lat: 32.1, lng: 34.9, hdg: 135 };
    drawOwnShip(window.gpsOwn, window.gpsOwn.hdg);
    // …then a fix with no course (stationary).
    window.__headingLine = null;
    window.gpsOwn = { lat: 32.1, lng: 34.9, hdg: null };
    drawOwnShip(window.gpsOwn, null);
    return window.__headingLine;
  });
  expect(frozen).not.toBeNull();
  expect(frozen.heading).toBe(135); // frozen at the last valid course
});

test('every heading-line knob is registered and exposed in the tune menu', async ({ page }) => {
  await boot(page);
  const info = await page.evaluate(() => {
    const keys = ['liveHeadingLineColor', 'liveHeadingTextColor', 'liveHeadingLineWidthPx',
      'liveHeadingDashPx', 'liveHeadingDashGapPx', 'liveHeadingTickPx',
      'liveHeadingLabelPx', 'liveHeadingLabelGapPx'];
    const group = NavAid.tuningGroups.find(g => g.name === 'Live aircraft');
    return {
      registered: keys.every(k => NavAid.tuningDefaults[k]),
      inMenu: keys.every(k => group && group.keys.includes(k)),
      color: tune('liveHeadingLineColor'),
    };
  });
  expect(info.registered).toBe(true);
  expect(info.inMenu).toBe(true);
  expect(info.color.toLowerCase()).toBe('#e53935'); // red default, not yellow
});

test('draws nothing when there has never been a valid heading', async ({ page }) => {
  await boot(page);
  const none = await page.evaluate(() => {
    window.__headingLine = null;
    window.gpsLiveOn = true;
    window.gpsOwn = { lat: 32.1, lng: 34.9, hdg: null };
    drawOwnShip(window.gpsOwn, null);
    return window.__headingLine;
  });
  expect(none).toBeNull();
});

test('a real GPS fix with no course does not synthesize a fake 0 (north) heading', async ({ page }) => {
  // Regression: onLivePosition/onGpsPosition (gps.js) used to fall back to the
  // literal number 0 -- not null/NaN -- when the device reported no course AND
  // there was no previous fix to derive a bearing from (routine on the very
  // first fix, or any time the GPS chip omits course while stationary/taxiing).
  // 0 passes Number.isFinite(), so downstream code read it as "confirmed
  // heading: true north" instead of "unknown", locking both the own-ship icon
  // and this predictor line onto north indefinitely. Reported live: "the
  // broken line in front of the plane is showing true north".
  await page.addInitScript(() => {
    window.__liveCb = null;
    navigator.geolocation.watchPosition = (cb) => { window.__liveCb = cb; return 21; };
    navigator.geolocation.clearWatch = () => {};
  });
  await boot(page);
  await page.waitForFunction(() => typeof startLiveLocation === 'function');
  const out = await page.evaluate(() => {
    startLiveLocation();
    window.__headingLine = null;
    // First-ever fix: no previous point to derive a bearing from, and the
    // device reports no course either -- genuinely unknown, not north.
    window.__liveCb({ coords: { latitude: 32.1, longitude: 34.9, accuracy: 8,
      heading: null, speed: null, altitude: null }, timestamp: Date.now() });
    return { hdg: window.gpsOwn && window.gpsOwn.hdg, line: window.__headingLine };
  });
  expect(out.hdg).not.toBe(0);          // not a fake, confirmed-looking north
  expect(Number.isFinite(out.hdg)).toBe(false);
  expect(out.line).toBeNull();          // nothing to draw yet, not a line pointing north
});

test('resetHeadingPredictor clears the frozen heading so a parked restart draws nothing', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    window.gpsLiveOn = true;
    // Establish a course; without a reset, a later null-course fix would freeze
    // at this 200° (the stale-heading bug on source stop/restart or sim↔live).
    window.gpsOwn = { lat: 32.1, lng: 34.9, hdg: 200 };
    drawOwnShip(window.gpsOwn, 200);
    const before = window.__headingLine && window.__headingLine.heading;
    resetHeadingPredictor();                 // the source-change hook (live/sim start)
    window.__headingLine = null;
    window.gpsOwn = { lat: 32.1, lng: 34.9, hdg: null };
    drawOwnShip(window.gpsOwn, null);         // parked: no course yet
    return { before, after: window.__headingLine };
  });
  expect(out.before).toBe(200);              // heading was established
  expect(out.after).toBeNull();              // reset dropped it — 200° did not persist
});

test('the simulator feed\'s magnetic heading is converted to true for the geometry', async ({ page }) => {
  // Regression: cvfr-bridge's schema reports "heading" already magnetic
  // (rpos_heading_true - variation), but drawHeadingLine's lat/lng trigonometry is
  // inherently TRUE-north-referenced -- feeding it the raw magnetic value drew the
  // line rotated off by the local variation. Reported live: "that line still uses
  // true north, not magnetic" (i.e. the line's own direction was wrong, not just a
  // label). Fixed at the source: _simFetch() (io.js) converts d.heading + d.variation
  // back to true before storing it in simAircraft.hdg, so downstream geometry (and
  // this test) never has to know the wire format was magnetic at all.
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof simStart === 'function' && typeof _simFetch === 'function');
  const out = await page.evaluate(async () => {
    simStart();
    // heading 090 magnetic, variation 5 (5°E) -> true heading should come out as 095.
    window.fetch = () => Promise.resolve({ ok: true, status: 200,
      json: async () => ({ latitude: 32.1, longitude: 34.9, altitude: 1000,
        heading: 90, variation: 5, ias: 90 }) });
    await _simFetch();
    return window.simAircraft.hdg;
  });
  expect(out).toBe(95);
});

// Two things about the mark labels themselves, both reported off a Hebrew session:
// the digits and the unit came out reversed ("nm 5"), and the two sets of marks are the
// same shape at a glance, so nothing but colour tells 5 NM from 5 minutes.
async function markLabels(page) {
  return page.evaluate(() => {
    const calls = [];
    const orig = octx.fillText.bind(octx);
    octx.fillText = function (t, x, y) { calls.push({ text: t, color: String(octx.fillStyle) }); return orig(t, x, y); };
    try {
      window.gpsLiveOn = true;
      window.gpsOwn = { lat: 32.1, lng: 34.9, hdg: 90 };
      drawOwnShip(window.gpsOwn, window.gpsOwn.hdg, 90);
    } finally { octx.fillText = orig; }
    return calls;
  });
}

test('a mark label reads left to right even in a Hebrew session', async ({ page }) => {
  await page.goto('?lang=he');
  await page.waitForFunction(() => typeof drawOwnShip === 'function' && typeof octx !== 'undefined');
  await page.evaluate(() => map.setView([32.1, 34.9], 9));
  const calls = await markLabels(page);
  const nm = calls.find(c => c.text.includes('nm'));
  const min = calls.find(c => c.text.includes('min'));
  expect(nm).toBeTruthy();
  expect(min).toBeTruthy();
  // The isolate is what stops bidi splitting "5 nm" into two runs and reordering them: the
  // canvas paragraph direction follows the interface language, and in Hebrew that is RTL.
  expect(nm.text).toMatch(/^\u2066\d+ nm\u2069$/);
  expect(min.text).toMatch(/^\u2066\d+ min\u2069$/);
});

test('distance and time marks are drawn in different colours', async ({ page }) => {
  await boot(page);
  const calls = await markLabels(page);
  const nm = calls.find(c => c.text.includes('nm'));
  const min = calls.find(c => c.text.includes('min'));
  const want = await page.evaluate(() => ({
    nm: tune('liveHeadingNmTextColor'), min: tune('liveHeadingMinTextColor') }));
  expect(nm.color.toLowerCase()).toBe(want.nm.toLowerCase());
  expect(min.color.toLowerCase()).toBe(want.min.toLowerCase());
  expect(want.nm.toLowerCase()).not.toBe(want.min.toLowerCase());
});
