// @ts-check
// Regression tests for orient default + persistence (PR #195) and the PNG
// export filename pattern, which depends on pageSize being set via setPage().
const { test, expect } = require('./_setup');
const { pairLLHZ_LLHA } = require('./_airfieldArp');

async function boot(page) {
  // Sentinel so the clear only runs on the first navigation — a reload in
  // a persistence test would otherwise wipe the value we just set.
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
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof setPage === 'function');
}

test.describe('Orient default + persistence (#195)', () => {
  test('Fresh boot: pageOrient defaults to portrait', async ({ page }) => {
    await boot(page);
    const o = await page.evaluate(() => pageOrient);
    expect(o).toBe('portrait');
  });

  test('A4 click with default orient → portrait dimensions (h > w)', async ({ page }) => {
    await boot(page);
    await page.locator('#page-a4').click();
    const d = await page.evaluate(() => ({ ...pageDims(), size: pageSize, orient: pageOrient }));
    expect(d.size).toBe('A4');
    expect(d.orient).toBe('portrait');
    // Portrait: h (long) > w (short). A4 portrait dims are roughly h=4.0 NM, w=3.0 NM.
    expect(d.h).toBeGreaterThan(d.w);
  });

  test('Toggle to landscape, refresh → still landscape', async ({ page }) => {
    await boot(page);
    await page.locator('#page-orient').click();           // portrait → landscape
    expect(await page.evaluate(() => pageOrient)).toBe('landscape');
    expect(await page.evaluate(() => localStorage.getItem('navaid.pageOrient'))).toBe('landscape');
    await page.reload();
    await page.waitForFunction(() => typeof pageOrient !== 'undefined');
    const o = await page.evaluate(() => pageOrient);
    expect(o).toBe('landscape');           // var binding restored from storage
  });

  test('Toggle to landscape, then back to portrait, refresh → still portrait', async ({ page }) => {
    await boot(page);
    await page.locator('#page-orient').click();           // portrait → landscape
    await page.locator('#page-orient').click();           // landscape → portrait
    expect(await page.evaluate(() => pageOrient)).toBe('portrait');
    await page.reload();
    await page.waitForFunction(() => typeof pageOrient !== 'undefined');
    expect(await page.evaluate(() => pageOrient)).toBe('portrait');
  });

  test('window.pageOrient writes reach the lexical binding (#195 var fix)', async ({ page }) => {
    await boot(page);
    // Mimic the boot restore path in ui.js: window.pageOrient = 'landscape'.
    // Under 'let' this would leave the lexical at 'portrait'; under 'var'
    // both bindings track each other.
    const sameSlot = await page.evaluate(() => {
      window.pageOrient = 'landscape';
      return pageOrient === 'landscape';
    });
    expect(sameSlot).toBe(true);
  });
});

test.describe('PNG export filename respects pageSize + orient', () => {
  // The full exportPNG path (tile load + canvas render + blob download) can
  // run past the 15s default test timeout on a loaded CI runner — and the
  // download wait below already allows 30s, which the 15s cap could never
  // reach. test.slow() triples the timeout (→45s) so the download wait is
  // the real bound, not the test envelope.
  test.slow();

  test('Export with A4 set: download name matches navigation-A4-*.png', async ({ page }) => {
    await boot(page);
    // Switch to OSM so this export test uses small, stable test tiles.
    await page.locator('#layer-select').selectOption('OpenStreetMap');
    await page.evaluate(wps => {
      state.waypoints = wps;
      syncLegs();
      draw();
    }, pairLLHZ_LLHA());
    await page.locator('#page-a4').click();
    const dl = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('#print').click();
    await page.locator('.modal-back button:first-child').click();
    const download = await dl;
    expect(download.suggestedFilename()).toMatch(/^navigation-LLHZ-to-LLHA-A4-.+\.png$/);
  });

  test('Export with no page frame: filename uses the base layer name', async ({ page }) => {
    await boot(page);
    await page.locator('#layer-select').selectOption('OpenStreetMap');
    await page.evaluate(wps => {
      state.waypoints = wps;
      syncLegs();
      draw();
    }, pairLLHZ_LLHA());
    // pageSize stays null — exporter falls back to the baseName (layer-derived).
    const dl = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('#print').click();
    await page.locator('.modal-back button:first-child').click();
    const download = await dl;
    expect(download.suggestedFilename()).toMatch(/^navigation-.+-\d.+\.png$/);
  });
});
