// @ts-check
const { test, expect } = require('./_setup');

test.describe('NavAid smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        // Sections collapse by default; open all so buttons are visible.
        for (const s of ['build','view','display','charts','export','print']) {
          localStorage.setItem('navaid.sec.' + s, '1');
        }
      } catch (e) {}
    });
  });

  test('boots in English with toolbar visible', async ({ page }) => {
    await page.goto('?lang=en');
    await expect(page).toHaveTitle('NavAid — CVFR Israel Map Navigation Aid & Flight Planner');
    await expect(page.locator('#toolbar')).toBeVisible();
    await expect(page.locator('#tool-add')).toHaveText(/Add waypoint/);
  });

  test('boots in Hebrew when localStorage prefers he and switches to English', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('navaid.lang', 'he'); } catch (e) {} });
    await page.goto('.');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    await page.locator('#lang-select').selectOption('en');
    await page.waitForURL(/lang=en/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('#87: language switch preserves query params', async ({ page }) => {
    await page.goto('?lang=he&utm_source=test&deep=42');
    await page.locator('#lang-select').selectOption('en');
    await page.waitForURL(/lang=en/);
    const url = new URL(page.url());
    expect(url.searchParams.get('lang')).toBe('en');
    expect(url.searchParams.get('utm_source')).toBe('test');
    expect(url.searchParams.get('deep')).toBe('42');
  });

  test('#124: search shows both airfields and nav-waypoints for broad query', async ({ page }) => {
    await page.goto('?lang=en');
    await page.waitForFunction(() => window.airfields && window.airfields.length > 0);
    await page.waitForFunction(() => window.navWP && window.navWP.length > 0);
    // Search input lives in a floating overlay (hidden by default). Click
    // the toolbar trigger to reveal it before typing.
    await page.locator('#search-trigger').click();
    await page.locator('#wp-search').fill('LL');
    await page.locator('#wp-search').dispatchEvent('input');
    const items = page.locator('#wp-search-results .wp-search-item');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(12);
  });

  test('#126: normLegLabel removed (no leftover global)', async ({ page }) => {
    await page.goto('?lang=en');
    const exists = await page.evaluate(() => typeof window.normLegLabel === 'function');
    expect(exists).toBe(false);
  });

  test('add two waypoints via state and verify legs sync', async ({ page }) => {
    await page.goto('?lang=en');
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.0, lng: 34.9, name: 'A' },
        { lat: 32.5, lng: 35.5, name: 'B' },
      ];
      syncLegs();
      draw();
    });
    const legCount = await page.evaluate(() => state.legs.length);
    expect(legCount).toBe(1);
    await expect(page.locator('#summary-legs-val, #stats .legs, #toolbar')).toContainText(/1/);
  });

  test('clear map button removes all waypoints', async ({ page }) => {
    await page.goto('?lang=en');
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.0, lng: 34.9, name: 'A' },
        { lat: 32.5, lng: 35.5, name: 'B' },
      ];
      syncLegs();
      draw();
    });
    page.once('dialog', d => d.accept());
    await page.locator('#clear').click();
    const wpCount = await page.evaluate(() => state.waypoints.length);
    expect(wpCount).toBe(0);
  });
});
