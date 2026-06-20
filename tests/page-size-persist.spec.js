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
});

test('toggling the page frame off clears the persisted size', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => setPage('A3'));
  await page.evaluate(() => setPage('A3'));          // same button toggles off
  expect(await page.evaluate(() => pageSize)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('navaid.pageSize'))).toBeNull();
});
