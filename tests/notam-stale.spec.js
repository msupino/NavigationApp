// @ts-check
// The NOTAM feed is scraped hourly and can wedge (the IAA site's bot wall stopped it for a day).
// A day-old list that reads as current is the false-safe this app refuses, so once the feed is
// older than notamStaleHours the freshness line turns into a caution -- in the panel and the list.
const { test, expect } = require('./_setup');

const NOTAM_RE = /notam-data\/notam\.json/;
const N = [{ id: 'C1/26', icao: 'LLBG', end: '', geom: null, text: 'C1 LLBG one.' }];

async function boot(page, hoursOld, lang = 'en') {
  const gen = new Date(Date.now() - hoursOld * 3600000).toISOString();
  await page.route(NOTAM_RE, r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ generatedAt: gen, notams: N }) }));
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); localStorage.setItem('navaid.sec.charts', '1'); } catch (e) {} });
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && document.getElementById('notam-cb'));
  await page.locator('#notam-cb').check();
  await page.waitForFunction(() => Array.isArray(notams) && notams.length === 1);
}
const panel = (page) => page.locator('#notam-updated');
const openList = (page) => page.evaluate(() => document.getElementById('notam-list-btn').click());

test('a fresh feed: the line is plain, no caution', async ({ page }) => {
  await boot(page, 1);                                    // 1 h old, under the 6 h budget
  await expect(panel(page)).not.toHaveClass(/notam-stale/);
  expect(await panel(page).textContent()).not.toMatch(/out of date/i);
});

test('a stale feed: the panel line becomes a caution naming it', async ({ page }) => {
  await boot(page, 26);                                   // a day old
  await expect(panel(page)).toHaveClass(/notam-stale/);
  await expect(panel(page)).toContainText('may be out of date');
  // ...and it still carries the update time.
  await expect(panel(page)).toContainText('Updated');
});

test('the list modal carries the same caution', async ({ page }) => {
  await boot(page, 26);
  await openList(page);
  const u = page.locator(".notam-modal .notam-updated");
  await expect(u).toHaveClass(/notam-stale/);
  await expect(u).toContainText('may be out of date');
});

test('notamStaleHours 0 turns the warning off', async ({ page }) => {
  await boot(page, 240);                                  // ten days old
  await expect(panel(page)).toHaveClass(/notam-stale/);   // warns by default
  await page.evaluate(() => { setTune('notamStaleHours', 0); window.showNotamOverlay ? null : null; });
  // Re-render the panel: toggle the overlay off and on.
  await page.locator('#notam-cb').uncheck();
  await page.locator('#notam-cb').check();
  await page.waitForFunction(() => Array.isArray(notams) && notams.length === 1);
  await expect(panel(page)).not.toHaveClass(/notam-stale/);
});

test('the Hebrew caution', async ({ page }) => {
  await boot(page, 26, 'he');
  await expect(panel(page)).toHaveClass(/notam-stale/);
  await expect(panel(page)).toContainText('ייתכן שאינו עדכני');
});
