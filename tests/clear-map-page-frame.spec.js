// @ts-check
// Asked: "clear map should remove A3/A4 layout". The #clear handler already dropped the page
// frame, but the button counted a map holding only the frame as empty: it stayed dimmed
// ("The map is already empty") and a press was refused, with the frame still drawn.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('navaid.routes');
      localStorage.removeItem('navaid.pageSize');
    } catch (e) { /* storage unavailable */ }
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof setPage === 'function' && typeof draw === 'function'
    && !!document.getElementById('clear'));
  // An extra layer on by default is itself something Clear map takes away; switch them off so
  // the frame is the only thing on the map.
  await page.evaluate(() => {
    for (const cb of document.querySelectorAll('.tb-section[data-sec="weather"] input[type="checkbox"]:checked')) {
      cb.checked = false;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

const frame = (page) => page.evaluate(() => ({
  size: pageSize,
  stored: localStorage.getItem('navaid.pageSize'),
  a4: document.getElementById('page-a4').getAttribute('aria-pressed'),
}));

test('on an otherwise empty map, the A4 frame alone keeps Clear map live, and Clear removes it', async ({ page }) => {
  await boot(page);
  const dimmed = () => page.evaluate(() => {
    return document.getElementById('clear').classList.contains('is-dim');
  });
  expect(await dimmed(), 'nothing on the map yet').toBe(true);
  await page.evaluate(() => setPage('A4'));
  expect((await frame(page)).size).toBe('A4');
  expect(await dimmed(), 'the frame is something to clear').toBe(false);

  await page.evaluate(() => document.getElementById('clear').click());
  expect(await frame(page)).toEqual({ size: null, stored: null, a4: 'false' });
  expect(await dimmed()).toBe(true);
});
