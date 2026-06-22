// @ts-check
// In light mode the A3/A4 page-size buttons signal "selected" only via
// aria-pressed (they have no .tool class), and the light-theme active rule used
// to match only `button.tool.active` — so a selected page button rendered as
// plain white with no visible selected state. It must show the blue highlight.
const { test, expect } = require('./_setup');

const BLUE = 'rgb(29, 111, 224)';   // #1d6fe0

async function boot(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.theme', 'light'); } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof setPage === 'function' && document.body.classList.contains('theme-light'));
}

test('selected A3 page button is highlighted in light mode', async ({ page }) => {
  await boot(page);
  const bg = await page.evaluate(() => {
    setPage('A3');
    const b = document.getElementById('page-a3');
    return getComputedStyle(b).backgroundColor;
  });
  expect(bg).toBe(BLUE);
});

test('selected A4 page button is highlighted in light mode', async ({ page }) => {
  await boot(page);
  const bg = await page.evaluate(() => {
    setPage('A4');
    const b = document.getElementById('page-a4');
    return getComputedStyle(b).backgroundColor;
  });
  expect(bg).toBe(BLUE);
});

test('unselected page button is not highlighted in light mode', async ({ page }) => {
  await boot(page);
  const bg = await page.evaluate(() => {
    setPage('A3');                                   // A3 on, A4 off
    return getComputedStyle(document.getElementById('page-a4')).backgroundColor;
  });
  expect(bg).not.toBe(BLUE);                         // stays white/neutral
});
