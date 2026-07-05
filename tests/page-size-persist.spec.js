// The A3/A4 page frame should survive a reload (re-centres on the map view).
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof setPage === 'function' && typeof pageSize !== 'undefined');
}

test('A4 page frame persists across reload', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => setPage('A4'));
  expect(await page.evaluate(() => pageSize)).toBe('A4');
  expect(await page.evaluate(() => localStorage.getItem('navaid.pageSize'))).toBe('A4');
  await page.reload();
  await page.waitForFunction(() => typeof pageSize !== 'undefined');
  expect(await page.evaluate(() => pageSize)).toBe('A4');
  await expect(page.locator('#page-a4')).toHaveClass(/active/);
  // The selected-state highlight keys off aria-pressed (the A3/A4 buttons have
  // no .tool class), so a restored size must set it or it renders unhighlighted.
  await expect(page.locator('#page-a4')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#page-a3')).toHaveAttribute('aria-pressed', 'false');
});

test('a restored page size is highlighted in dark mode', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('navaid.theme', 'dark');
      localStorage.setItem('navaid.pageSize', 'A4');
    } catch (e) {}
  });
  await boot(page);
  await page.waitForFunction(() => document.body.classList.contains('theme-dark'));
  await expect(page.locator('#page-a4')).toHaveAttribute('aria-pressed', 'true');
  const bg = await page.evaluate(() =>
    getComputedStyle(document.getElementById('page-a4')).backgroundColor);
  expect(bg).toBe('rgb(29, 111, 224)');   // the selected-state blue, not plain
});

test('toggling the page frame off clears the persisted size', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => setPage('A3'));
  await page.evaluate(() => setPage('A3'));          // same button toggles off
  expect(await page.evaluate(() => pageSize)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('navaid.pageSize'))).toBeNull();
});
