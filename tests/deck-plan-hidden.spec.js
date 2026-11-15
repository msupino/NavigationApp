// @ts-check
// On the deck (phone/tablet) the Flight plan has its own tab on the bottom bar, so the standalone
// Flight plan button in the Menu sheet is a duplicate -- it is hidden there. The bottom-bar tab
// still opens the plan (it presses the hidden button by id). The desktop menubar keeps the button.
const { test, expect } = require('./_setup');

test('on the deck, the Menu has no duplicate Flight plan button, but the bottom-bar tab opens it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showFlightPlan === 'function' && typeof clearBootLoading === 'function');
  await expect(page.locator('body')).toHaveClass(/deck-on/);

  // The standalone Flight plan button is present (the deck tab presses it) but not shown.
  const plan = page.locator('#plan');
  await expect(plan).toHaveCount(1);
  await expect(plan).toBeHidden();

  // The bottom bar has its own Plan tab. With a route it is enabled; pressing it opens the plan
  // (by pressing the hidden #plan button), proving hiding the Menu duplicate did not break it.
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.2, lng: 35.0, name: 'B' }];
    if (typeof syncLegs === 'function') syncLegs();
    draw();
  });
  const tab = page.locator('#deck-bar [data-deck="plan"]');
  await expect(tab).toBeVisible();
  await expect(tab).not.toHaveClass(/is-dim/);
  await tab.click();
  expect(await page.evaluate(() => typeof fpOpen !== 'undefined' && fpOpen)).toBeTruthy();
});

test('on the desktop menubar, the Flight plan button is shown (no bottom bar there)', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showFlightPlan === 'function' && typeof clearBootLoading === 'function');
  await expect(page.locator('body')).not.toHaveClass(/deck-on/);
  await expect(page.locator('#plan')).toBeVisible();
});
