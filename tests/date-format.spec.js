// @ts-check
// One setting, navaid.dateFormat, writes every user-visible date. Israel's civil default is
// day-first (dmy). The NOTAM "updated" line (and other display dates) follow it; the time stays
// Zulu. Filenames and <input type=date> values keep their own fixed ISO form (not covered here).
const { test, expect } = require('./_setup');

const NOTAM_RE = /notam-data\/notam\.json/;
const GEN = '2026-03-09T13:45:00Z';           // 9 March 2026, 13:45 UTC -- day != month, unambiguous
const N = [{ id: 'C1/26', icao: 'LLBG', end: '', geom: null, text: 'C1.' }];

async function updatedLine(page, fmt) {
  await page.addInitScript((f) => { try {
    localStorage.setItem('navaid.sec.weather', '1'); localStorage.setItem('navaid.sec.charts', '1');
    if (f) localStorage.setItem('navaid.dateFormat', f);
  } catch (e) {} }, fmt);
  await page.route(NOTAM_RE, r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ generatedAt: GEN, notams: N }) }));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && document.getElementById('notam-cb'));
  await page.locator('#notam-cb').check();
  await page.waitForFunction(() => Array.isArray(notams) && notams.length === 1);
  return (await page.locator('#notam-updated').textContent()) || '';
}

test('default (Israel) writes the NOTAM date day-first, time in Zulu', async ({ page }) => {
  expect(await updatedLine(page, null)).toContain('09/03/2026 13:45Z');
});
test('mdy writes month-first', async ({ page }) => {
  expect(await updatedLine(page, 'mdy')).toContain('03/09/2026 13:45Z');
});
test('ymd writes ISO-style', async ({ page }) => {
  expect(await updatedLine(page, 'ymd')).toContain('2026-03-09 13:45Z');
});
test('fmtDate honours the setting for a local date', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof fmtDate === 'function');
  const r = await page.evaluate(() => {
    const d = new Date(2026, 2, 9);  // 9 Mar 2026 local
    const out = {};
    for (const f of ['dmy','mdy','ymd']) { localStorage.setItem('navaid.dateFormat', f); out[f] = fmtDate(d); }
    return out;
  });
  expect(r).toEqual({ dmy: '09/03/2026', mdy: '03/09/2026', ymd: '2026-03-09' });
});
