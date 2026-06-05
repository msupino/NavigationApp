// @ts-check
// Tests for PR #98 — typing space-separated nav-WP codes in #wp-search
// and pressing Enter builds a route through those waypoints.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_mws_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_mws_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined');
  // navWP loads lazily on first draw or buildRouteFromQuery — pre-warm it
  // so the tests don't race the fetch.
  await page.evaluate(() => loadNavWaypoints());
  await page.waitForFunction(() => Array.isArray(window.navWP) && window.navWP.length > 0);
  // Airfields too, for airfield-token resolution.
  await page.evaluate(() => loadAirfields && loadAirfields());
  await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
}

async function openSearch(page) {
  await page.locator('#search-trigger').click();
  await page.locator('#wp-search').waitFor();
}

test.describe('Multi-token search route builder (#98)', () => {
  test('single-token search behaves unchanged: dropdown opens, no route built', async ({ page }) => {
    await boot(page);
    await openSearch(page);
    await page.fill('#wp-search', 'BAZRA');
    // Dropdown visible.
    await expect(page.locator('#wp-search-results')).toBeVisible();
    // No route built yet.
    const len = await page.evaluate(() => state.waypoints.length);
    expect(len).toBe(0);
  });

  test('Enter on single-token query with trailing space picks dropdown suggestion (not build)', async ({ page }) => {
    await boot(page);
    await openSearch(page);
    await page.fill('#wp-search', 'BAZRA ');
    // Dropdown is hidden when trailing-space tail is empty, so first re-type
    // without trailing space, dropdown reappears, then Enter selects.
    await page.fill('#wp-search', 'BAZRA');
    await page.waitForSelector('.wp-search-item');
    // Now add a trailing space (single token + whitespace).
    await page.fill('#wp-search', 'BAZRA ');
    await page.locator('#wp-search').press('Enter');
    // Route must NOT be built (only one real token).
    await page.waitForTimeout(150);
    const len = await page.evaluate(() => state.waypoints.length);
    expect(len).toBe(0);
  });

  test('two-token Enter builds a 2-waypoint route', async ({ page }) => {
    await boot(page);
    await openSearch(page);
    await page.fill('#wp-search', 'BAZRA GNYAM');
    await page.locator('#wp-search').press('Enter');
    await page.waitForFunction(() => state.waypoints.length === 2);
    const names = await page.evaluate(() => state.waypoints.map(w => w.name));
    expect(names).toEqual(['BAZRA', 'GNYAM']);
  });

  test('multi-token query suppresses dropdown when trailing whitespace (empty tail)', async ({ page }) => {
    await boot(page);
    await openSearch(page);
    await page.fill('#wp-search', 'BAZRA ');
    await expect(page.locator('#wp-search-results')).toBeHidden();
  });

  test('unknown token alerts and leaves the route unchanged', async ({ page }) => {
    await boot(page);
    // Seed an existing route.
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.1, lng: 34.9, name: 'PRESET' }];
      syncLegs(); draw();
    });
    let alerted = null;
    page.once('dialog', d => { alerted = d.message(); d.accept(); });

    await openSearch(page);
    await page.fill('#wp-search', 'BAZRA NOPE_TOKEN');
    await page.locator('#wp-search').press('Enter');

    await page.waitForTimeout(150);
    expect(alerted).toContain('NOPE_TOKEN');
    const names = await page.evaluate(() => state.waypoints.map(w => w.name));
    expect(names).toEqual(['PRESET']);
  });

  test('existing route prompts a replace confirmation; cancel keeps the old route', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.1, lng: 34.9, name: 'PRESET' }];
      syncLegs(); draw();
    });
    page.once('dialog', d => { d.dismiss(); });   // user clicks Cancel

    await openSearch(page);
    await page.fill('#wp-search', 'BAZRA GNYAM');
    await page.locator('#wp-search').press('Enter');

    await page.waitForTimeout(150);
    const names = await page.evaluate(() => state.waypoints.map(w => w.name));
    expect(names).toEqual(['PRESET']);
  });

  test('airfield codes resolve too: LLHZ BAZRA builds a route', async ({ page }) => {
    await boot(page);
    await openSearch(page);
    await page.fill('#wp-search', 'LLHZ BAZRA');
    await page.locator('#wp-search').press('Enter');
    await page.waitForFunction(() => state.waypoints.length === 2);
    const names = await page.evaluate(() => state.waypoints.map(w => w.name));
    expect(names).toEqual(['LLHZ', 'BAZRA']);
  });

  test('airfield aliases resolve to canonical ICAO codes: HABONIM builds LLBO', async ({ page }) => {
    await boot(page);
    await openSearch(page);
    await page.fill('#wp-search', 'HABONIM BAZRA');
    await page.locator('#wp-search').press('Enter');
    await page.waitForFunction(() => state.waypoints.length === 2);
    const names = await page.evaluate(() => state.waypoints.map(w => w.name));
    expect(names).toEqual(['LLBO', 'BAZRA']);
  });

  test('nav-waypoint English labels resolve to canonical chart codes', async ({ page }) => {
    await boot(page);
    await openSearch(page);
    await page.fill('#wp-search', 'SdotYam EIRON');
    await page.locator('#wp-search').press('Enter');
    await page.waitForFunction(() => state.waypoints.length === 2);
    const out = await page.evaluate(() => ({
      names: state.waypoints.map(w => w.name),
      labels: state.waypoints.map(w => navName(w.name)),
    }));
    expect(out.names).toEqual(['SDTYM', 'EIRON']);
    expect(out.labels[0]).toBe('Sdot Yam');
  });

  test('autofill: after "LLHZ BAZ" the dropdown offers BAZRA-style matches', async ({ page }) => {
    await boot(page);
    await openSearch(page);
    await page.fill('#wp-search', 'LLHZ BAZ');
    // Dropdown should be visible with hits for the last token.
    await expect(page.locator('#wp-search-results')).toBeVisible();
    const hits = await page.locator('.wp-search-item').allTextContents();
    expect(hits.some(t => /BAZRA/i.test(t))).toBe(true);
  });

  test('autofill searches nav-waypoint English labels and keeps the code visible', async ({ page }) => {
    await boot(page);
    await openSearch(page);
    await page.fill('#wp-search', 'sdot');
    await page.waitForSelector('.wp-search-item');
    const hits = await page.locator('.wp-search-item').allTextContents();
    expect(hits.some(t => /Sdot Yam.*SDTYM/i.test(t))).toBe(true);
  });

  test('clicking an autofill hit replaces the last token + adds trailing space', async ({ page }) => {
    await boot(page);
    await openSearch(page);
    await page.fill('#wp-search', 'LLHZ BAZ');
    await page.waitForSelector('.wp-search-item');
    // Click the BAZRA hit.
    const bazra = page.locator('.wp-search-item').filter({ hasText: /BAZRA/i }).first();
    await bazra.click();
    expect(await page.locator('#wp-search').inputValue()).toMatch(/^LLHZ BAZRA $/);
  });

  test('search hint element is rendered with i18n text', async ({ page }) => {
    await boot(page);
    await openSearch(page);
    const txt = await page.locator('#wp-search-hint').textContent();
    expect(txt).toMatch(/space-separated/i);
  });
});
