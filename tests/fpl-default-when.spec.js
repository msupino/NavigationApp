// @ts-check
// The EOBT the filing dialog proposes. It used to offer the filing lead plus five minutes,
// rounded up to the next TEN -- an 11:07 that no pilot would have picked and the desk would
// have to read back digit by digit. It now proposes the lead (an hour) out, rounded UP to
// the next quarter hour: the granularity an EOBT is actually chosen in.
//
// Rounding UP, not to nearest, is the load-bearing part: the proposal must never open
// already inside the 60-minute filing rule, which is what rounding down would do for
// three quarters of every quarter hour.
const { test, expect } = require('./_setup');

// The function works in LOCAL time (it feeds two native date/time inputs), so the browser
// timezone is pinned rather than left to whatever the runner happens to be.
test.use({ timezoneId: 'Asia/Jerusalem' });

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof fplDefaultWhen === 'function');
}

// Ask the page what it would propose for a given local wall-clock instant.
const propose = (page, y, mo, d, h, mi, s = 0) => page.evaluate(
  ([y1, mo1, d1, h1, mi1, s1]) => fplDefaultWhen(new Date(y1, mo1 - 1, d1, h1, mi1, s1)),
  [y, mo, d, h, mi, s]);

test('the proposed time is an hour out, rounded up to the next quarter', async ({ page }) => {
  await boot(page);
  // On the hour: exactly an hour out is already a quarter, so it stands.
  expect(await propose(page, 2026, 6, 21, 10, 0)).toEqual({ date: '2026-06-21', time: '11:00' });
  // One minute past: 11:01 rounds up to 11:15, never down to 11:00.
  expect(await propose(page, 2026, 6, 21, 10, 1)).toEqual({ date: '2026-06-21', time: '11:15' });
  // Either side of a quarter boundary.
  expect(await propose(page, 2026, 6, 21, 10, 14)).toEqual({ date: '2026-06-21', time: '11:15' });
  expect(await propose(page, 2026, 6, 21, 10, 15)).toEqual({ date: '2026-06-21', time: '11:15' });
  expect(await propose(page, 2026, 6, 21, 10, 16)).toEqual({ date: '2026-06-21', time: '11:30' });
  // Rounding up past the last quarter rolls the hour.
  expect(await propose(page, 2026, 6, 21, 10, 46)).toEqual({ date: '2026-06-21', time: '12:00' });
});

test('seconds count towards the lead rather than being rounded away', async ({ page }) => {
  await boot(page);
  // 10:00:30 + 60 min is 11:00:30. Truncating to 11:00 would propose 59.5 minutes out and
  // trip the 60-minute warning on the dialog's own default, so it goes to the next quarter.
  expect(await propose(page, 2026, 6, 21, 10, 0, 30)).toEqual({ date: '2026-06-21', time: '11:15' });
  expect(await propose(page, 2026, 6, 21, 10, 15, 1)).toEqual({ date: '2026-06-21', time: '11:30' });
});

test('an evening plan rolls the date, not just the clock', async ({ page }) => {
  await boot(page);
  expect(await propose(page, 2026, 6, 21, 23, 50)).toEqual({ date: '2026-06-22', time: '01:00' });
  // The last minute of a month, and of a year.
  expect(await propose(page, 2026, 6, 30, 23, 30)).toEqual({ date: '2026-07-01', time: '00:30' });
  expect(await propose(page, 2026, 12, 31, 23, 30)).toEqual({ date: '2027-01-01', time: '00:30' });
});

test('every proposal clears the 60-minute filing rule and lands on a quarter', async ({ page }) => {
  await boot(page);
  const bad = await page.evaluate(() => {
    const out = [];
    for (let mi = 0; mi < 60; mi++) {
      for (const s of [0, 1, 59]) {
        const now = new Date(2026, 5, 21, 10, mi, s);
        const w = fplDefaultWhen(now);
        const at = new Date(w.date + 'T' + w.time);
        const lead = (at.getTime() - now.getTime()) / 60000;
        // Never short of the rule, never more than a quarter past it, always on a quarter.
        if (lead < 60 || lead > 75 || at.getMinutes() % 15) out.push({ mi, s, time: w.time, lead });
      }
    }
    return out;
  });
  expect(bad).toEqual([]);
});

test('the filing dialog opens on that proposal', async ({ page }) => {
  await page.addInitScript(() => {
    const fixed = new Date(2026, 5, 21, 10, 5, 0).getTime();
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [fixed])); }
      static now() { return fixed; }
    };
    try {
      for (const sec of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + sec, '1');
    } catch (e) {}
  });
  await boot(page);
  await page.evaluate(() => showFplDialog && showFplDialog());
  await expect(page.locator('#fpl-date')).toHaveValue('2026-06-21');
  await expect(page.locator('#fpl-time')).toHaveValue('11:15');
});
