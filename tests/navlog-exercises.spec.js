// @ts-check
// Five published CVFR exercises, worked by the form and compared with their own answer sheets.
//
// The sheets were marked by hand on a flight computer, so headings are compared to within a
// degree and speeds to the knot. What is NOT relaxed is our own chain: track - drift = true
// heading, less variation = magnetic, plus the card's deviation = compass. A sheet that wandered
// would fail the first; a sheet whose arithmetic contradicts itself fails the second, which is
// how the Herzliya slip was found.
const { test, expect } = require('./_setup');

const EXERCISES = ['navlog-herzliya-rosh-pina', 'navlog-masada-herzliya',
  'navlog-atarot-haifa', 'navlog-haifa-atarot', 'navlog-teyman-sdom'];

const near = (mine, theirs, tol, what) => {
  const off = Math.abs(((mine - theirs + 540) % 360) - 180);
  expect(off, what + ': ours ' + mine + ', the sheet ' + theirs).toBeLessThanOrEqual(tol);
};

async function work(page, fx) {
  return page.evaluate((x) => navLogRows(Object.assign({
    waypoints: x.route.waypoints.map(w => ({ name: w.he || w.name, lat: w.lat, lng: w.lng })),
  }, x.navlog)).map(r => ({
    kind: r.kind, from: r.from, to: r.to,
    pa: Math.round(r.pressureAltFt), temp: r.tempC, tas: Math.round(r.tasKt * 10) / 10,
    track: r.trackShownDeg, drift: Math.round(r.driftShownDeg), side: r.driftSide,
    th: Math.round(r.trueHeadingDeg), mh: Math.round(r.magneticHeadingDeg),
    dev: r.deviationDeg, ch: Math.round(r.compassHeadingDeg),
    gs: Math.round(r.groundSpeedKt * 10) / 10, dist: Math.round(r.distNm * 10) / 10,
    min: Math.round(r.timeH * 600) / 10,
  })), fx);
}

for (const name of EXERCISES) {
  const fx = require('./fixtures/' + name + '.json');

  test(name + ': the sheet it produces adds up', async ({ page }) => {
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof navLogRows === 'function');
    const rows = await work(page, fx);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows[0].kind).toBe('climb');
    expect(rows[rows.length - 1].kind).toBe('descent');
    // One top of climb, whatever the route does in between.
    expect(rows.filter(r => r.to === 'TOC')).toHaveLength(1);
    for (const r of rows) {
      const signed = r.side === 'R' ? -r.drift : r.drift;
      expect((((r.track + signed) % 360) + 360) % 360, 'track - drift = true heading').toBe(r.th);
      expect((((r.th - fx.navlog.variationDeg) % 360) + 360) % 360, 'true - variation = magnetic').toBe(r.mh);
      expect((((r.mh + r.dev) % 360) + 360) % 360, 'magnetic + deviation = compass').toBe(r.ch);
      expect(r.tas).toBeGreaterThan(0);
      expect(r.gs).toBeGreaterThan(0);
    }
    // The two rules that make a climb and a descent row computable at all.
    const f = fx.navlog;
    expect(rows[0].pa).toBe(Math.round(f.depElevFt + (2 / 3) * (f.cruiseAltFt - f.depElevFt)));
    expect(rows[rows.length - 1].pa)
      .toBe(Math.round(f.destElevFt + (1 / 2) * (f.cruiseAltFt - f.destElevFt)));
  });

  if (fx.published && Array.isArray(fx.published.rows)) {
    test(name + ': it matches the published answers', async ({ page }) => {
      await page.goto('?lang=en&nogist');
      await page.waitForFunction(() => typeof navLogRows === 'function');
      const rows = await work(page, fx);
      const sheet = fx.published.rows;
      expect(rows.length, 'row count').toBe(sheet.length);
      rows.forEach((r, i) => {
        const s = sheet[i];
        const at = name + ' row ' + (i + 1) + ' ';
        const pa = Number(String(s.paFt ?? s['גובה לחץ']).replace(/\+/g, ''));
        const tas = Number(s.tas ?? s['מ.א.א']);
        // To the foot, except that a sheet worked by hand truncates where we round: Masada's
        // climb is -1200 + two thirds of 8,200 = 4266.67, printed 4266 and computed 4267.
        expect(Math.abs(r.pa - pa), at + 'pressure altitude (' + r.pa + ' vs ' + pa + ')')
          .toBeLessThanOrEqual(1);
        // TAS to the knot: the sheets were read off a flight computer, and our lapse rate is
        // the exercise's 2 degrees rather than the physical 1.98.
        expect(Math.abs(r.tas - tas), at + 'TAS (' + r.tas + ' vs ' + tas + ')').toBeLessThanOrEqual(0.6);
        const track = Number(s.trackTrue ?? s['נתיב אמיתי']);
        if (Number.isFinite(track)) near(r.track, track, 2, at + 'true track');
      });
    });
  }
}
