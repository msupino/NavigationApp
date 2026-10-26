// @ts-check
// An iPad: a wide touch screen. The deck switches on for a coarse pointer at any width, so the
// old floating menu has to be off there too -- it was hidden only while collapsed, and a wide
// screen starts it expanded, so the iPad showed both (reported). And a search typed in the
// deck's Menu sheet is done once it has built the route: Return used to leave the menu open.
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: true });

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && window.NavAid
    && typeof NavAid.refreshMobileDeck === 'function' && Array.isArray(navWP) && navWP.length
    && Array.isArray(airfields) && airfields.length);
  await page.evaluate(() => {
    const b = document.getElementById('boot-loading');
    if (b) b.remove();
    document.documentElement.classList.remove('app-booting');
  });
}

test('on an iPad the deck replaces the old menu entirely', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  await expect(page.locator('#deck-bar')).toBeVisible();
  await expect(page.locator('#toolbar')).toBeHidden();
  // Even with a saved "expanded" from before the deck existed.
  await page.evaluate(() => { localStorage.setItem('navaid.toolbarCollapsed', '0'); });
  await page.reload();
  await boot(page);
  await expect(page.locator('#toolbar')).toBeHidden();
  // The menu is still all there, in the sheet.
  await page.locator('#deck-bar .deck-btn-menu').click();
  await expect(page.locator('#deck-sheet #toolbar')).toBeVisible();
});

test('Return in the sheet search builds the route and puts the menu away', async ({ page }) => {
  await boot(page);
  await page.locator('#deck-bar .deck-btn-menu').click();
  await expect(page.locator('#deck-sheet #wp-search')).toBeVisible();
  await page.locator('#wp-search').fill('LLHZ BAZRA DEROR');
  await page.locator('#wp-search').press('Enter');
  await expect.poll(() => page.evaluate(() => state.waypoints.map(w => w.name))).toEqual(['LLHZ', 'BAZRA', 'DEROR']);
  await expect(page.locator('#deck-sheet')).toBeHidden();
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).not.toBe('wp-search');
});

test('featureTabletDesktop gives the iPad the desktop menubar, and back', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#deck-bar')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.classList.contains('menubar'))).toBe(false);
  const flip = (on) => page.evaluate((v) => {
    NavAid.tuning.featureTabletDesktop = v;
    NavAid.refreshDesktopMenu();
    NavAid.refreshMobileDeck();
  }, on);
  await flip(true);
  expect(await page.evaluate(() => document.documentElement.classList.contains('menubar'))).toBe(true);
  await expect(page.locator('body')).not.toHaveClass(/deck-on/);
  await expect(page.locator('#deck-bar')).toHaveCount(0);
  // The menubar: one row along the top, its sections opening as dropdowns on a tap.
  const bar = await page.locator('#toolbar').boundingBox();
  expect(bar.height).toBeLessThan(80);
  expect(bar.width).toBeGreaterThan(500);
  await page.locator('.tb-section[data-sec="settings"] .tb-section-head').click();
  await expect(page.locator('.tb-section[data-sec="settings"] .tb-section-body')).toBeVisible();
  await page.screenshot({ path: 'test-results/ipad-desktop-layout.png' });
  await flip(false);
  expect(await page.evaluate(() => document.documentElement.classList.contains('menubar'))).toBe(false);
  await expect(page.locator('#deck-bar')).toBeVisible();
});
