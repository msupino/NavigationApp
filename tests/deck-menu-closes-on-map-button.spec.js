// @ts-check
// Asked, with a screenshot: pressing a map button while the Menu is open left the Menu open, and
// the chart picker opened on top of it. A map button now closes the Menu, then does its own job.
const { test, expect } = require('./_setup');

test.use({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });

test('a map button closes the open Menu and still does its job', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof NavAid !== 'undefined' && NavAid.deckSheetOpen);
  await page.locator('.deck-btn-menu').click();
  await expect.poll(() => page.evaluate(() => NavAid.deckSheetOpen())).toBe(true);
  await page.locator('#edit-col-layers').click();
  await expect.poll(() => page.evaluate(() => NavAid.deckSheetOpen())).toBe(false);
  // What the button opens stays open.
  await expect(page.locator('#edit-col-layers')).toHaveAttribute('aria-expanded', 'true');
});

test('the details of a point stay while the map buttons are used', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof NavAid !== 'undefined' && NavAid.deckSheetOpen && typeof showInspector === 'function');
  await page.evaluate(() => { state.selected = { type: 'coord', lat: 32.1, lng: 34.9 }; showInspector(); });
  await expect(page.locator('#inspector')).toBeVisible();
  // Whatever map control the layout leaves visible beside the panel; a click is a click.
  await page.evaluate(() => document.querySelector('.leaflet-control-zoom-in').click());
  await expect(page.locator('#inspector')).toBeVisible();
});
