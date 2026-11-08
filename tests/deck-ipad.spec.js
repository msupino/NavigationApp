// @ts-check
// An iPad: a wide touch screen. The deck switches on for a coarse pointer at any width, so the
// old floating menu has to be off there too -- it was hidden only while collapsed, and a wide
// screen starts it expanded, so the iPad showed both (reported). And a search typed in the
// deck's Menu sheet is done once it has built the route: Return used to leave the menu open.
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: true });

async function boot(page, lang = 'en') {
  await page.goto(`?lang=${lang}&nogist`);
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
  await expect(page.locator('#tablet-layout')).toHaveValue('auto');
  await page.screenshot({ path: 'test-results/ipad-desktop-layout.png' });
  await flip(false);
  expect(await page.evaluate(() => document.documentElement.classList.contains('menubar'))).toBe(false);
  await expect(page.locator('#deck-bar')).toBeVisible();
});

test('iPad Settings overrides the gist default and remembers the chosen layout', async ({ page }) => {
  await boot(page);
  const openTabletSettings = async () => {
    const menu = page.locator('#toolbar .tb-section[data-sec="settings"]');
    if (await page.locator('#deck-bar').count()) await page.locator('#deck-bar .deck-btn-menu').click();
    if (!(await menu.locator('.tb-section-body').isVisible())) await menu.locator('.tb-section-head').click();
    const picker = page.locator('#tablet-layout');
    await expect(picker).toBeVisible();
    return picker;
  };

  expect(await page.evaluate(() => localStorage.getItem('navaid.tabletLayout'))).toBeNull();
  await expect(page.locator('#deck-bar')).toBeVisible(); // gist default is mobile
  let picker = await openTabletSettings();
  await expect(picker).toHaveValue('auto');
  await picker.selectOption('desktop');
  await expect(page.locator('#deck-bar')).toHaveCount(0);
  await expect(page.locator('html')).toHaveClass(/menubar/);
  expect(await page.evaluate(() => localStorage.getItem('navaid.tabletLayout'))).toBe('desktop');

  await page.reload();
  await boot(page);
  await expect(page.locator('#deck-bar')).toHaveCount(0);
  await expect(page.locator('html')).toHaveClass(/menubar/);
  picker = await openTabletSettings();
  await expect(picker).toHaveValue('desktop');
  await picker.selectOption('mobile');
  await expect(page.locator('#deck-bar')).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/menubar/);
  expect(await page.evaluate(() => localStorage.getItem('navaid.tabletLayout'))).toBe('mobile');

  await page.reload();
  await boot(page);
  await expect(page.locator('#deck-bar')).toBeVisible();
  picker = await openTabletSettings();
  await picker.selectOption('auto');
  await expect(page.locator('#deck-bar')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('navaid.tabletLayout'))).toBeNull();
});

test('iPad layout choices are localized in Hebrew', async ({ page }) => {
  await boot(page, 'he');
  await page.locator('#deck-bar .deck-btn-menu').click();
  const settings = page.locator('#deck-sheet .tb-section[data-sec="settings"]');
  await settings.locator('.tb-section-head').click();
  await expect(page.locator('#tablet-layout-row > span')).toHaveText('פריסת טאבלט');
  await expect(page.locator('#tablet-layout option[value="auto"]')).toHaveText('אוטומטי');
  await expect(page.locator('#tablet-layout option[value="mobile"]')).toHaveText('נייד');
  await expect(page.locator('#tablet-layout option[value="desktop"]')).toHaveText('מחשב');
});
