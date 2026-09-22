// @ts-check
// Scrubbing the map clock forward must never walk the weather backwards.
//
// Two rules used to meet at live. At the live end the shared dropdown chose the valid time
// NEAREST now; one step off live handed over to followInstant, which took the newest sheet
// issued at or BEFORE the hour. With a feed that publishes every six hours those disagree by
// a whole interval, so stepping the clock forward one hour moved the chart back six:
//
//     live  15:00Z -> 18:00Z sheet
//     +1h   16:00Z -> 12:00Z sheet      <- the weather went backwards
//
// Reported as: now is good, next step goes backwards in time.
//
// followInstant now uses the same rule as the seed -- nearest to the hour, which is the
// right reading for a FORECAST valid at a time -- and, like every other move, chooses within
// what the enabled layers can actually draw.
const { test, expect } = require('./_setup');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64');
const BOUNDS = { s: 29.88, n: 33.82, w: 33.31, e: 36.69 };

// The two manifests as they are actually published: SIGWX carries the prog charts and skips
// the 12:00 that PWX has, which is what made the disagreement visible.
const SIGWX = { generatedAt: 'x', times: [
  { valid: '06:00', day: '20/06/2026', png: 'ims/sigwx/a.png' },
  { valid: '12:00', day: '20/06/2026', png: 'ims/sigwx/b.png' },
  { valid: '18:00', day: '21/06/2026', png: 'ims/sigwx/c.png' },
  { valid: '00:00', day: '22/06/2026', png: 'ims/sigwx/d.png' },
  { valid: '03:00', day: '22/06/2026', png: 'ims/sigwx/e.png' }] };
const PWX = { generatedAt: 'x', bounds: BOUNDS, levels: [{ level: '950', label: 'FL020', times: [
  { valid: '12:00', day: '21/06/2026', png: 'ims/pwx/a.png' },
  { valid: '18:00', day: '21/06/2026', png: 'ims/pwx/b.png' },
  { valid: '00:00', day: '22/06/2026', png: 'ims/pwx/c.png' },
  { valid: '03:00', day: '22/06/2026', png: 'ims/pwx/d.png' },
  { valid: '06:00', day: '22/06/2026', png: 'ims/pwx/e.png' }] }] };

// 15:00Z on 21/06 — squarely between the 12:00 and 18:00 sheets, where the two rules differ.
async function boot(page, layerCb) {
  await page.addInitScript(() => {
    const fixed = Date.UTC(2026, 5, 21, 15, 0);
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [fixed])); }
      static now() { return fixed; }
    };
    for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
      try { localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.route(/ims-data\/ims\/.*\.png/, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(/ims-data\/ims\/sigwx\.json/, r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(SIGWX) }));
  await page.route(/ims-data\/ims\/pwx\.json/, r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(PWX) }));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => document.querySelectorAll('#wx-time option').length >= 6);
  for (const id of [].concat(layerCb)) {
    await page.evaluate((cbId) => {
      const cb = document.getElementById(cbId);
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }, id);
  }
}

// Walk the slider and report the sheet at each hour, with whether the map is stamped.
const walk = (page, hours) => page.evaluate((hh) => {
  const out = [];
  for (const h of hh) {
    const s = document.getElementById('map-time-slider');
    s.value = String(h);
    s.dispatchEvent(new Event('input'));
    const wm = document.getElementById('weather-unavailable-watermark');
    out.push({ h, chart: document.getElementById('wx-time').value, stamped: !!(wm && !wm.hidden) });
  }
  return out;
}, hours);

const epoch = (v) => {
  const [day, valid] = v.split('|');
  const [d, m, y] = day.split('/').map(Number);
  const [hh, mm] = valid.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm);
};

test('scrubbing forward never moves the chart backwards', async ({ page }) => {
  await boot(page, 'sigwx-ov-cb');
  const rows = await walk(page, [0, 1, 2, 3, 4, 5, 6, 9, 12]);
  // The exact case from the report: live and the very next step.
  expect(rows[0].chart).toBe('21/06/2026|18:00');
  expect(rows[1].chart).toBe('21/06/2026|18:00');
  // And across the whole track, the sheet only ever advances.
  const times = rows.map(r => epoch(r.chart));
  for (let i = 1; i < times.length; i++) {
    expect(times[i], 'chart went backwards at +' + rows[i].h + 'h: '
      + rows[i - 1].chart + ' -> ' + rows[i].chart).toBeGreaterThanOrEqual(times[i - 1]);
  }
});

test('scrubbing does not land the layer on an hour it cannot draw', async ({ page }) => {
  await boot(page, 'sigwx-ov-cb');
  const rows = await walk(page, [0, 1, 2, 3, 4, 5, 6, 9, 12]);
  // 21/06 12:00 is PWX-only. Scrubbing used to pick it and stamp "unavailable" across a map
  // whose one enabled layer had a chart an hour or two away.
  expect(rows.filter(r => r.stamped)).toEqual([]);
  expect(rows.some(r => r.chart === '21/06/2026|12:00')).toBe(false);
});

test('with both layers on it stays on hours they share', async ({ page }) => {
  await boot(page, ['ims-pwx-cb', 'sigwx-ov-cb']);
  const rows = await walk(page, [0, 1, 3, 6, 9, 12]);
  const shared = ['21/06/2026|18:00', '22/06/2026|00:00', '22/06/2026|03:00'];
  for (const r of rows) expect(shared, 'at +' + r.h + 'h').toContain(r.chart);
  expect(rows.filter(r => r.stamped)).toEqual([]);
});

test('the sheet for an hour is the nearest one, not the last one issued before it', async ({ page }) => {
  await boot(page, 'ims-pwx-cb');
  // 16:00Z is two hours from the 18:00 sheet and four from the 12:00 one. A pilot planning to
  // be airborne at 16:00 wants the forecast either side of them, not the one already stale.
  const rows = await walk(page, [1]);
  expect(rows[0].chart).toBe('21/06/2026|18:00');
});
