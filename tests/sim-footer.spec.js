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
  // Three stacked buttons: connect, follow, center.
  await expect(page.locator('#sim-modal .modal.sim-modal > button:not(.sim-modal-close)')).toHaveCount(3);
  await expect(page.locator('#sim-modal #sim-connect-cb')).toBeVisible();
  await expect(page.locator('#sim-modal #sim-follow-cb')).toBeVisible();
  await expect(page.locator('#sim-modal #sim-center')).toBeVisible();
  await expect(page.locator('#sim-modal #sim-url')).toBeVisible();

  // Center is a one-shot — clicking flashes for feedback even with no live
  // aircraft (muted no-data flash).
  await page.locator('#sim-modal #sim-center').click();
  await expect(page.locator('#sim-modal #sim-center')).toHaveClass(/sim-flash/);

  // Follow is a toggle with a visible active (aria-pressed) state.
  const follow = page.locator('#sim-modal #sim-follow-cb');
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'true');
  await follow.click();
  await expect(follow).toHaveAttribute('aria-pressed', 'false');

  // Esc closes.
  await page.keyboard.press('Escape');
  await expect(page.locator('#sim-modal')).toBeHidden();

  // Close button also works.
  await trigger.click();
  await expect(page.locator('#sim-modal')).toBeVisible();
  await page.locator('#sim-modal-close').click();
  await expect(page.locator('#sim-modal')).toBeHidden();
});

test('the sim icon stays visible on a mobile viewport -- connecting one is how the watch alerts get tested there', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !!document.getElementById('sim-trigger'));
  await expect(page.locator('#sim-trigger')).toBeVisible();
});
