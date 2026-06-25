// @ts-check
// The Simulator (SimConnect) controls moved from a toolbar section to a small
// footer icon that opens a modal panel.
const { test, expect } = require('./_setup');

test('footer sim icon opens the simulator panel; Esc closes it', async ({ page }) => {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined');

  // No simulator toolbar section anymore.
  await expect(page.locator('.tb-section[data-sec="sim"]')).toHaveCount(0);

  // Footer icon present; modal hidden initially.
  const trigger = page.locator('#sim-trigger');
  await expect(trigger).toBeVisible();
  await expect(page.locator('#sim-modal')).toBeHidden();

  // Opening reveals the sim controls.
  await trigger.click();
  await expect(page.locator('#sim-modal')).toBeVisible();
  await expect(page.locator('#sim-modal #sim-connect-cb')).toBeVisible();
  await expect(page.locator('#sim-modal #sim-url')).toBeVisible();

  // Esc closes.
  await page.keyboard.press('Escape');
  await expect(page.locator('#sim-modal')).toBeHidden();

  // Close button also works.
  await trigger.click();
  await expect(page.locator('#sim-modal')).toBeVisible();
  await page.locator('#sim-modal-close').click();
  await expect(page.locator('#sim-modal')).toBeHidden();
});
