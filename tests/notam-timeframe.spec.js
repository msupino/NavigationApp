// @ts-check
// The NOTAM list showed only what is in force right now, which hides the one a pilot most
// wants to read: an aerodrome closure that starts in twenty minutes. Reported as "why this
// notam doesn't exist in navaid" for A0673/26 — it was in the feed, correctly parsed, and
// eleven minutes from starting. The list now has a time-frame toggle, defaulting to Active.
const { test, expect } = require('./_setup');

const HOUR = 3600 * 1000;
async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showNotamModal === 'function');
  await page.evaluate(([hour]) => {
    const now = Date.now();
    const iso = (t) => new Date(t).toISOString();
    window.notams = [
      { id: 'A0001/26', icao: 'LLBG', type: 'FALT', text: 'IN FORCE NOW',
        start: iso(now - hour), end: iso(now + hour), geom: null },
      { id: 'A0673/26', icao: 'LLBG', type: 'FALT', text: 'AD CLSD FOR LDG FLT, DUE LABOR DISPUTE.',
        start: iso(now + hour / 4), end: iso(now + 6 * hour), geom: null },
      { id: 'A0002/26', icao: 'LLHZ', type: 'FALT', text: 'ALREADY OVER',
        start: iso(now - 4 * hour), end: iso(now - hour), geom: null },
    ];
    showNotamModal();
  }, [HOUR]);
  await page.waitForSelector('.notam-list');
}

const ids = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.notam-list .notam-item')].map(i => i.textContent).join('|'));

test('by default the list is what is in force now', async ({ page }) => {
  await boot(page);
  const t = await ids(page);
  expect(t).toContain('A0001/26');
  expect(t).not.toContain('A0673/26');   // starts in 15 minutes
  expect(t).not.toContain('A0002/26');   // ended an hour ago
});

test('the toggle brings in the ones not in force', async ({ page }) => {
  await boot(page);
  await page.check('#notam-show-all');
  const t = await ids(page);
  expect(t).toContain('A0001/26');
  expect(t).toContain('A0673/26');
  expect(t).toContain('A0002/26');
});

test('a NOTAM that is not in force says when it starts, or that it ended', async ({ page }) => {
  await boot(page);
  await page.check('#notam-show-all');
  const badges = await page.evaluate(() =>
    [...document.querySelectorAll('.notam-list .notam-item')].map(i => ({
      id: (i.textContent.match(/A\d{4}\/26/) || [''])[0],
      when: (i.querySelector('.notam-when') || {}).textContent || '',
      past: !!(i.querySelector('.notam-when-past')),
    })));
  const future = badges.find(b => b.id === 'A0673/26');
  const over = badges.find(b => b.id === 'A0002/26');
  const live = badges.find(b => b.id === 'A0001/26');
  expect(future.when).toMatch(/^from /);
  expect(future.past).toBe(false);
  expect(over.when).toBe('ended');
  expect(over.past).toBe(true);
  expect(live.when).toBe('');            // in force: no badge, nothing to explain
});

test('unchecking goes back to the active list', async ({ page }) => {
  await boot(page);
  await page.check('#notam-show-all');
  await page.uncheck('#notam-show-all');
  expect(await ids(page)).not.toContain('A0673/26');
});

// A single NOTAM opened from the map is neither list: it shows what was clicked.
test('a map-clicked NOTAM has no time-frame toggle', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showNotamModal === 'function');
  await page.evaluate(() => showNotamModal([{ id: 'A9/26', icao: 'LLBG', text: 'ONE', start: null, end: null }]));
  await page.waitForSelector('.notam-list');
  expect(await page.locator('#notam-show-all').count()).toBe(0);
});
