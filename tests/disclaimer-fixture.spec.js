// @ts-check
// The suite's switch for the safety notice, which opens on EVERY launch now. It used to be
// pre-acknowledged in storage, and a spec that cleared storage in an init script wiped the
// acknowledgement before the notice looked -- so the modal appeared in the middle of a test
// about something else. Nothing is stored any more: the switch is a window flag, which a
// storage reset cannot reach, and the reason to keep testing it is the same either way.
const { test, expect } = require('./_setup');

test('the notice stays out of tests that clear storage, and out of their reloads', async ({ page }) => {
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.maybeShowDisclaimer);
  expect(await page.evaluate(() => window.__navaidNoDisclaimer)).toBe(true);
  await page.evaluate(() => { if (typeof clearBootLoading === 'function') clearBootLoading(); });
  await expect(page.locator('.disclaimer-back')).toHaveCount(0);
  // A reload is a launch, so this is the case that would bite hardest if the flag did not
  // survive one.
  await page.reload();
  await page.waitForFunction(() => window.NavAid && NavAid.maybeShowDisclaimer);
  await page.evaluate(() => { if (typeof clearBootLoading === 'function') clearBootLoading(); });
  await expect(page.locator('.disclaimer-back')).toHaveCount(0);
  expect(await page.evaluate(() => NavAid.maybeShowDisclaimer())).toBeNull();
});
