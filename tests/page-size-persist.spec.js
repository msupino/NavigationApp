// The A3/A4 page frame should survive a reload (re-centres on the map view).
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof setPage === 'function' && typeof pageSize !== 'undefined');
}

test('A4 page frame persists across reload', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => setPage('A4'));
  expect(await page.evaluate(() => pageSize)).toBe('A4');
  expect(await page.evaluate(() => localStorage.getItem('navaid.pageSize'))).toBe('A4');
  await page.reload();
  await page.waitForFunction(() => typeof pageSize !== 'undefined');
  expect(await page.evaluate(() => pageSize)).toBe('A4');
  await expect(page.locator('#page-a4')).toHaveClass(/active/);
  // The selected-state highlight keys off aria-pressed (the A3/A4 buttons have
  // no .tool class), so a restored size must set it or it renders unhighlighted.
  await expect(page.locator('#page-a4')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#page-a3')).toHaveAttribute('aria-pressed', 'false');
});

test('a restored page size is highlighted in dark mode', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('navaid.theme', 'dark');
      localStorage.setItem('navaid.pageSize', 'A4');
    } catch (e) {}
  });
  await boot(page);
  await page.waitForFunction(() => document.body.classList.contains('theme-dark'));
  await expect(page.locator('#page-a4')).toHaveAttribute('aria-pressed', 'true');
  const bg = await page.evaluate(() =>
    getComputedStyle(document.getElementById('page-a4')).backgroundColor);
  expect(bg).toBe('rgb(29, 111, 224)');   // the selected-state blue, not plain
});

test('toggling the page frame off clears the persisted size', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => setPage('A3'));
  await page.evaluate(() => setPage('A3'));          // same button toggles off
  expect(await page.evaluate(() => pageSize)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('navaid.pageSize'))).toBeNull();
});

test('gist tuning applies independent A3 and A4 fit zoom offsets', async ({ page }) => {
  await boot(page);
  const zooms = await page.evaluate(() => {
    const defaults = [tune('a3FitZoomOffset'), tune('a4FitZoomOffset')];
    const fitAt = (size, a3, a4) => {
      setTune('a3FitZoomOffset', a3);
      setTune('a4FitZoomOffset', a4);
      pageSize = size;
      fitPageFrame();
      return map.getZoom();
    };
    const a4Base = fitAt('A4', 0, 0);
    const a4Adjusted = fitAt('A4', 0, -0.5);
    const a3Base = fitAt('A3', 0, 0);
    const a3Adjusted = fitAt('A3', 0.25, 0);
    const a4x2Base = fitAt('A4x2', 0, 0);
    const a4x2Adjusted = fitAt('A4x2', -0.25, 0.75);
    return {
      defaults,
      a4Base, a4Adjusted, a3Base, a3Adjusted, a4x2Base, a4x2Adjusted,
    };
  });
  expect(zooms.defaults).toEqual([0, 0]);
  expect(zooms.a4Adjusted).toBeCloseTo(zooms.a4Base - 0.5, 5);
  expect(zooms.a3Adjusted).toBeCloseTo(zooms.a3Base + 0.25, 5);
  expect(zooms.a4x2Adjusted).toBeCloseTo(zooms.a4x2Base - 0.25, 5);
});
