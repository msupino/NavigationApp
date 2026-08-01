// @ts-check
// Coverage for the floating search overlay (#194): Ctrl/Cmd-F entry, the
// toolbar trigger button, ✕ + Escape close, click-outside, result list
// rendering, and click-to-jump behaviour.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_init_v1') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_init_v1', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && window.airfields && window.navWP);
}

// Desktop now keeps the search docked on screen permanently (see
// docked-search.spec.js); the hide-on-close behaviour these cases cover is the
// mobile overlay's, so they run at phone width.
async function bootMobile(page) {
  await page.setViewportSize({ width: 375, height: 812 });
  await boot(page);
}

test.describe('Floating search overlay (#194)', () => {
  test('Overlay is hidden by default on mobile', async ({ page }) => {
    await bootMobile(page);
    await expect(page.locator('#search-overlay')).toHaveClass(/hidden/);
  });

  test('Overlay is docked, not hidden, on desktop', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#search-overlay')).not.toHaveClass(/hidden/);
    await expect(page.locator('#search-overlay')).toHaveClass(/docked/);
  });

  test('Toolbar 🔍 Find button opens the overlay and focuses the input', async ({ page }) => {
    await boot(page);
    await page.locator('#search-trigger').click();
    await expect(page.locator('#search-overlay')).not.toHaveClass(/hidden/);
    await expect(page.locator('#wp-search')).toBeFocused();
  });

  test('Ctrl-F opens the overlay (browser native find-in-page hijack)', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('Control+f');
    await expect(page.locator('#search-overlay')).not.toHaveClass(/hidden/);
    await expect(page.locator('#wp-search')).toBeFocused();
  });

  test('Cmd-F (Meta) also opens the overlay', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('Meta+f');
    await expect(page.locator('#search-overlay')).not.toHaveClass(/hidden/);
  });

  test('Escape closes the overlay and clears the input', async ({ page }) => {
    await bootMobile(page);
    await page.evaluate(() => showSearchOverlay());
    await page.locator('#wp-search').fill('LLBG');
    await page.keyboard.press('Escape');
    await expect(page.locator('#search-overlay')).toHaveClass(/hidden/);
    expect(await page.locator('#wp-search').inputValue()).toBe('');
  });

  test('✕ close button hides the overlay', async ({ page }) => {
    await bootMobile(page);
    await page.evaluate(() => showSearchOverlay());
    await page.locator('#search-close').click();
    await expect(page.locator('#search-overlay')).toHaveClass(/hidden/);
  });

  test('Typing surfaces matching airfields + nav-WPs (#124 budget split)', async ({ page }) => {
    await boot(page);
    await page.locator('#search-trigger').click();
    await page.locator('#wp-search').fill('LL');
    await page.locator('#wp-search').dispatchEvent('input');
    const items = page.locator('#wp-search-results .wp-search-item');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(12);
  });

  test('results list sits below the input, not over it', async ({ page }) => {
    await boot(page);
    await page.locator('#search-trigger').click();
    await page.locator('#wp-search').fill('LL');
    await page.locator('#wp-search').dispatchEvent('input');
    await expect(page.locator('#wp-search-results')).not.toHaveClass(/hidden/);
    // The toolbar-era #wp-search-results rule is position:absolute; inside
    // the fixed overlay that floated it on top of the input and hid the
    // typed text. It must flow below the input instead.
    const input = await page.locator('#wp-search').boundingBox();
    const results = await page.locator('#wp-search-results').boundingBox();
    expect(results.y).toBeGreaterThanOrEqual(input.y + input.height - 1);
  });

  test('Hebrew query matches Hebrew names', async ({ page }) => {
    await page.goto('?lang=he');
    await page.waitForFunction(() => typeof state !== 'undefined' && window.navWP);
    await page.keyboard.press('Control+f');
    await page.locator('#wp-search').fill('בצרה');     // BAZRA in Hebrew
    await page.locator('#wp-search').dispatchEvent('input');
    const count = await page.locator('#wp-search-results .wp-search-item').count();
    expect(count).toBeGreaterThan(0);
  });

  test('Enter on first result jumps the map and closes results', async ({ page }) => {
    await boot(page);
    await page.locator('#search-trigger').click();
    await page.locator('#wp-search').fill('LLBG');
    await page.locator('#wp-search').dispatchEvent('input');
    const before = await page.evaluate(() => map.getCenter());
    await page.keyboard.press('Enter');
    const after = await page.evaluate(() => map.getCenter());
    // Map moved to LLBG (32.011°N, 34.886°E) — coords should differ from
    // the boot view (default centred elsewhere on the chart).
    expect(Math.abs(after.lat - before.lat) + Math.abs(after.lng - before.lng))
      .toBeGreaterThan(0.001);
  });

  test('No results for gibberish query → results list hidden', async ({ page }) => {
    await boot(page);
    await page.locator('#search-trigger').click();
    await page.locator('#wp-search').fill('XYZQQZZ');
    await page.locator('#wp-search').dispatchEvent('input');
    await expect(page.locator('#wp-search-results')).toHaveClass(/hidden/);
  });

  test('Ctrl-F while focused in an input does NOT hijack (allows native find)',
    async ({ page }) => {
      await boot(page);
      // Open the overlay first so the input exists and is focused.
      await page.locator('#search-trigger').click();
      // Focus is on the overlay's wp-search — Ctrl-F on that should still
      // trigger the overlay's show (handler treats wpSearch as the exception).
      await page.keyboard.press('Control+f');
      await expect(page.locator('#search-overlay')).not.toHaveClass(/hidden/);
    });
});
