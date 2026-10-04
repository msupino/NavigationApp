// @ts-check
// In the phone layout the edit column's lit Add button is the mode cue and the way out, so the
// blue "Adding waypoints — tap to stop" chip is not drawn over the chart. The desktop keeps it.
const { test, expect } = require('./_setup');

test('no mode chip over the chart in the phone layout; the edit column ends the mode', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => document.body.classList.contains('deck-on') && typeof setMode === 'function');
  await page.evaluate(() => setMode('add'));
  await expect(page.locator('#mode-chip')).toBeHidden();
  const add = page.locator('.edit-col-ctrl button').first();
  await expect(add).toHaveClass(/edit-col-on/);
  await add.click();
  expect(await page.evaluate(() => state.mode)).toBeNull();
});

test('the desktop still shows the chip', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof setMode === 'function');
  await page.evaluate(() => setMode('add'));
  await expect(page.locator('#mode-chip')).toBeVisible();
});
