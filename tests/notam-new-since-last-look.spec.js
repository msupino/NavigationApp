// @ts-check
// The pre-flight question is not "what is in force" -- the list answers that every time --
// but "what has changed since I last looked". Re-reading forty NOTAMs to find the one new
// one is how a pilot stops reading them at all.
const { test, expect } = require('./_setup');

const FEED = [
  { id: 'A0001/26', icao: 'LLHZ', text: 'RWY 11/29 CLSD', start: '2609010600', end: '2612312359' },
  { id: 'A0002/26', icao: 'LLHZ', text: 'CRANE ERECTED 1.5NM W', start: '2609010600', end: '2612312359' },
  { id: 'A0003/26', icao: 'LLBG', text: 'TWY B CLSD', start: '2609010600', end: '2612312359' },
];

async function boot(page, seen) {
  await page.addInitScript((s) => {
    if (s) localStorage.setItem('navaid.notamSeen', JSON.stringify(s));
  }, seen || null);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showNotamModal === 'function' && typeof notamSeenRead === 'function');
}

const openList = async (page, feed) => {
  await page.evaluate((f) => { showNotamModal(f); }, feed || FEED);
  await page.waitForSelector('.notam-item');
};
const newIds = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.notam-item-new .notam-id')].map(e => e.textContent.split(' ')[0]));

test('the first look marks nothing new', async ({ page }) => {
  await boot(page);
  await openList(page);
  // Nothing stored yet, and every NOTAM in the country is not a diff -- it is noise on the
  // one occasion the pilot cannot tell the difference.
  expect(await newIds(page)).toEqual([]);
  await expect(page.locator('.notam-modal-title, .notam-title, h2, h3').first()).not.toContainText('new');
});

test('what arrived since the last look is badged, and counted in the title', async ({ page }) => {
  // Two already read; the third is new.
  await boot(page, { 'A0001/26': Date.now() - 86400000, 'A0003/26': Date.now() - 86400000 });
  await openList(page);
  expect(await newIds(page)).toEqual(['A0002/26']);
  const title = await page.evaluate(() => {
    const h = [...document.querySelectorAll('.modal-back h2, .modal-back h3, .modal-back .modal-title')]
      .map(e => e.textContent).join(' ');
    return h;
  });
  expect(title).toMatch(/1 new/);
});

test('reading the list is what marks it read — and only on close', async ({ page }) => {
  await boot(page, { 'A0001/26': Date.now() - 86400000 });
  await openList(page);
  expect((await newIds(page)).length).toBe(2);
  // Still unmarked while it is open: marking on render would clear the badges the pilot
  // opened it to see.
  const duringOpen = await page.evaluate(() => Object.keys(notamSeenRead()).length);
  expect(duringOpen).toBe(1);

  await page.evaluate(() => {
    const back = document.querySelector('.modal-back[data-chart-modal="notam-list"]')
      || document.querySelector('.modal-back');
    if (back && back._navaidClose) back._navaidClose();
  });
  const afterClose = await page.evaluate(() => Object.keys(notamSeenRead()).sort());
  expect(afterClose).toEqual(['A0001/26', 'A0002/26', 'A0003/26']);

  // Opened again, nothing is new any more.
  await openList(page);
  expect(await newIds(page)).toEqual([]);
});

test('a NOTAM that leaves the feed and returns is not new again', async ({ page }) => {
  await boot(page, { 'A0001/26': Date.now() - 86400000, 'A0002/26': Date.now() - 86400000,
    'A0003/26': Date.now() - 86400000 });
  // The feed drops one for a cycle, then publishes it again.
  await openList(page, FEED.filter(n => n.id !== 'A0002/26'));
  await page.evaluate(() => {
    const back = document.querySelector('.modal-back');
    if (back && back._navaidClose) back._navaidClose();
  });
  await openList(page, FEED);
  expect(await newIds(page)).toEqual([]);
});

test('ids stop being remembered once they are older than the window', async ({ page }) => {
  await boot(page);
  const kept = await page.evaluate(() => {
    const old = Date.now() - 400 * 86400000;       // beyond notamSeenDays (90)
    localStorage.setItem('navaid.notamSeen', JSON.stringify({ 'OLD/20': old, 'RECENT/26': Date.now() }));
    notamSeenMark(['NEW/26']);
    return Object.keys(notamSeenRead()).sort();
  });
  // A NOTAM that left the feed cannot come back new, but its id would sit here for ever.
  expect(kept).toEqual(['NEW/26', 'RECENT/26']);
});

test('a corrupt store does not take the list down with it', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('navaid.notamSeen', '{not json'); });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showNotamModal === 'function');
  await openList(page);
  // Unreadable is treated as "nothing seen", which is the first-run case: no badges, and a
  // list that still opens.
  expect(await newIds(page)).toEqual([]);
  await expect(page.locator('.notam-item').first()).toBeVisible();
});
