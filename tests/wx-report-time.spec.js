// @ts-check
// The weather box used to print OUR fetch time ("Updated 00:53Z"), a fact about the feed
// rather than about the weather — and during a three-hour cron gap it said exactly that with
// no hint the reading was three hours old. Each report now shows its own issue time, which is
// the number the IAA site prints beside the same message, so the two compare directly.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => !document.getElementById('boot-loading'));
  await page.waitForFunction(() => typeof wxIssuedAt === 'function');
}

test('the feed\'s stated Created time wins over the raw group', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const now = new Date(Date.UTC(2026, 8, 3, 5, 30));
    return {
      // IAA states "Created: 03/09/2026 05:24" for a report observed at 05:20Z. The stated
      // publication time is what the site shows, so it is what we show.
      created: wxIssuedAt({ created: '2026-09-03T05:24:00Z', rawOb: 'METAR LLBG 030520Z' }, now),
      // AWC carries no such field, so the DDHHMMZ group is the fallback.
      fallback: wxIssuedAt({ rawOb: 'METAR LLBG 030520Z' }, now),
    };
  });
  expect(new Date(r.created).toISOString()).toBe('2026-09-03T05:24:00.000Z');
  expect(new Date(r.fallback).toISOString()).toBe('2026-09-03T05:20:00.000Z');
});

test('a day-of-month with no month never resolves into the future', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const oct1 = new Date(Date.UTC(2026, 9, 1, 2, 0));
    return {
      // September has no 31st. Naively substituting the current month produced 1 October —
      // a timestamp AHEAD of the reader's clock, which would read as brand new.
      impossible: wxReportTime('METAR LLHA 312350Z AUTO', oct1),
      // The ordinary rollover still resolves backwards, to the previous month.
      rollover: wxReportTime('METAR LLHA 302350Z AUTO', oct1),
    };
  });
  expect(r.impossible).toBeNull();
  expect(new Date(r.rollover).toISOString()).toBe('2026-09-30T23:50:00.000Z');
});

test('TAF validity end is read from the DDHH/DDHH group', async ({ page }) => {
  await boot(page);
  const to = await page.evaluate(() => {
    const now = new Date(Date.UTC(2026, 8, 3, 5, 30));
    return wxTafValidTo('TAF LLBG 030504Z 0306/0406 VRB04KT 9999 SCT025', now);
  });
  expect(new Date(to).toISOString()).toBe('2026-09-04T06:00:00.000Z');
});

// Render the real weather box against a mocked feed, so the badge and its stale styling
// are checked in the DOM rather than as arithmetic.
async function openWx(page, { created, rawOb, tafRaw }) {
  await page.route('**wx-data/wx.json**', r => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      generatedAt: '2026-06-14T06:00:00Z',
      source: 'IAA (brin.iaa.gov.il MobileAeroinfo)',
      stations: { LLBG: {
        metar: { icaoId: 'LLBG', rawOb, created, temp: 24, dewp: 18, altim: 1013, clouds: [] },
        taf: { icaoId: 'LLBG', rawTAF: tafRaw, fcsts: [] },
      } },
    }),
  }));
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof showInspector === 'function' &&
    typeof state !== 'undefined' && typeof fetchAirfieldWx === 'function');
  await page.evaluate(async () => {
    if (airfields === null) await loadAirfields();
    const index = airfields.findIndex(a => a.name === 'LLBG');
    state.selected = { type: 'airfield', index };
    showInspector();
  });
  await expect(page.locator('#insp-body .wx-section')).toBeVisible();
}

test('the METAR badge shows the report time, and dims until it is old', async ({ page }) => {
  const recent = new Date(Date.now() - 20 * 60e3);
  const hhmm = String(recent.getUTCHours()).padStart(2, '0') +
               String(recent.getUTCMinutes()).padStart(2, '0');
  await openWx(page, {
    created: recent.toISOString(),
    rawOb: 'LLBG ' + String(recent.getUTCDate()).padStart(2, '0') + hhmm + 'Z 27012KT CAVOK 24/18 Q1013',
    tafRaw: 'TAF LLBG 140500Z 1406/1506 28010KT 9999 SCT035',
  });
  const t = page.locator('.wx-block').first().locator('.wx-time');
  await expect(t).toBeVisible();
  await expect(t).toHaveText(hhmm.slice(0, 2) + ':' + hhmm.slice(2) + 'Z');
  await expect(t).not.toHaveClass(/wx-time-stale/);
});

test('a METAR hours old is marked stale in the box', async ({ page }) => {
  const old = new Date(Date.now() - 4 * 3600e3);
  await openWx(page, {
    created: old.toISOString(),
    rawOb: 'LLBG 140650Z 27012KT CAVOK 24/18 Q1013',
    tafRaw: 'TAF LLBG 140500Z 1406/1506 28010KT 9999 SCT035',
  });
  const t = page.locator('.wx-block').first().locator('.wx-time');
  await expect(t).toHaveClass(/wx-time-stale/);
  // The whole point of the badge: it names a time a pilot can compare, not "4 hours ago".
  await expect(t).toHaveText(/^\d{2}:\d{2}Z$/);
});

test('the source line no longer claims a time of its own', async ({ page }) => {
  await boot(page);
  // "Updated HH:MMZ" was our fetch time and could not be checked against anything the IAA
  // publishes. The row keeps the provenance and drops the number.
  const s = await page.evaluate(() => String(window.S && S.wxUpdated || ''));
  const src = await page.evaluate(() => String(window.S && S.wxSource || ''));
  expect(src).toBeTruthy();
  expect(s === '' || !/\{?time\}?/.test(s)).toBe(true);
});
