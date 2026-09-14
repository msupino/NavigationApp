// @ts-check
const { test, expect } = require('./_setup');

test('storage-reset tests retain the fixture acknowledgement before the notice runs', async ({ page }) => {
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.disclaimerVersion);
  expect(await page.evaluate(() => NavAid.disclaimerAccepted())).toBe(true);
  await expect(page.locator('.disclaimer-back')).toHaveCount(0);
  await page.reload();
  expect(await page.evaluate(() => NavAid.disclaimerAccepted())).toBe(true);
  await expect(page.locator('.disclaimer-back')).toHaveCount(0);
});
