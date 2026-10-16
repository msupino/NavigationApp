const { test, expect } = require('./_setup');

async function scrollInspector(page, delta) {
  await page.locator('#inspector').evaluate(el => {
    el.dataset.wheelReceived = '0';
    el.addEventListener('wheel', () => { el.dataset.wheelReceived = '1'; }, { once: true });
  });
  await page.mouse.wheel(0, delta);
  await expect(page.locator('#inspector')).toHaveAttribute('data-wheel-received', '1');
}

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
      await scrollInspector(page, delta);
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

for (const lang of ['en', 'he']) {
  for (const delta of [-120, 120]) {
    test(`closing LLHA does not transfer its remaining wheel gesture to the map: ${lang}, ${delta}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`?lang=${lang}&nogist`);
      await page.waitForFunction(() => typeof showInspector === 'function' && !document.getElementById('boot-loading'));
      const search = page.locator('#wp-search');
      await search.fill('LLHA');
      await expect(page.locator('#wp-search-results .wp-search-item').first()).toBeVisible();
      await search.press('Enter');
      await page.waitForFunction(() => !map._animatingZoom && !map._panAnim?._inProgress);
      const zoom = await page.evaluate(() => map.getZoom());
      await page.locator('#insp-body').hover({ position: { x: 100, y: 70 } });
      await scrollInspector(page, delta);
      await page.keyboard.press('Escape');
      await expect(page.locator('#inspector')).toBeHidden();
      // A trackpad's remaining samples hit the newly exposed map at the same pointer position.
      for (let i = 0; i < 5; i++) {
        await page.mouse.wheel(0, delta / 2);
        await page.waitForTimeout(70);
      }
      await page.waitForTimeout(150);
      expect(await page.evaluate(() => map.getZoom())).toBe(zoom);
      await page.waitForTimeout(400);
      await page.mouse.wheel(0, delta);
      await expect.poll(() => page.evaluate(() => map.getZoom())).not.toBe(zoom);
    });
  }
}

for (const closeBy of ['Escape', 'button']) {
  test(`deliberate map movement resumes zoom after inspector closes via ${closeBy}`, async ({ page }) => {
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => typeof showInspector === 'function' && !document.getElementById('boot-loading'));
    await page.evaluate(async () => {
      if (!airfields) await loadAirfields();
      state.selected = {type: 'airfield', index: airfields.findIndex(a => a.name === 'LLHA')};
      showInspector();
    });
    await page.locator('#insp-body').hover({position: {x: 100, y: 70}});
    await scrollInspector(page, 120);
    const zoom = await page.evaluate(() => map.getZoom());
    if (closeBy === 'Escape') await page.keyboard.press('Escape');
    else await page.locator('#insp-close').click();
    await expect(page.locator('#inspector')).toBeHidden();
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => map.getZoom())).toBe(zoom);
    await page.mouse.move(500, 400);
    await page.mouse.wheel(0, 120);
    await expect.poll(() => page.evaluate(() => map.getZoom())).not.toBe(zoom);
  });
}
