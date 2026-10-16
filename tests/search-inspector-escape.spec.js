const { test, expect } = require('./_setup');

for (const lang of ['en', 'he']) {
  for (const delta of [-600, 600]) {
    test(`Escape closes LLHA after keyboard search and inspector scroll: ${lang}, ${delta}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`?lang=${lang}&nogist`);
      await page.waitForFunction(() => typeof showInspector === 'function' && !document.getElementById('boot-loading'));
      const search = page.locator('#wp-search');
      await search.fill('LLHA');
      await expect(page.locator('#wp-search-results .wp-search-item').first()).toBeVisible();
      await search.press('Enter');
      await expect(page.locator('#inspector')).toBeVisible();
      await expect(search).toBeFocused();
      expect(await page.evaluate(() => airfields[state.selected.index].name)).toBe('LLHA');
      await page.waitForFunction(() => !map._animatingZoom && !map._panAnim?._inProgress);
      const zoom = await page.evaluate(() => map.getZoom());
      await page.locator('#insp-body').hover({ position: { x: 100, y: 70 } });
      await page.mouse.wheel(0, delta);
      await search.press('Escape');
      await expect(page.locator('#inspector')).toBeHidden();
      expect(await page.evaluate(() => state.selected)).toBeNull();
      await expect(search).toBeVisible();
      await expect(search).toHaveValue('');
      await expect(page.locator('#wp-search-results')).toBeHidden();
      await expect(page.locator('#search-examples')).toBeHidden();
      await expect.poll(() => page.evaluate(() => map.getZoom())).toBe(zoom);
      expect(await page.evaluate(() => localStorage.getItem('navaid.searchShown'))).toBeNull();
      await page.keyboard.press('Escape');
      await expect(search).toBeVisible();
    });
  }
}
