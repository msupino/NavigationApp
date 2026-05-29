// @ts-check
// Toolbar section toggles behave as an accordion: opening one closes
// every other currently-open section.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_acc_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        localStorage.setItem('__test_acc_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined');
}

test.describe('Section accordion (open one closes others)', () => {
  test('opening Build collapses Charts', async ({ page }) => {
    await boot(page);
    // Pre-open Charts so we have a section to close.
    await page.evaluate(() => {
      document.querySelector('.tb-section[data-sec="charts"]').classList.add('open');
      localStorage.setItem('navaid.sec.charts', '1');
    });
    await expect(page.locator('.tb-section[data-sec="charts"]')).toHaveClass(/open/);

    // Open Build by clicking its header.
    await page.locator('.tb-section[data-sec="build"] .tb-section-head').click();

    await expect(page.locator('.tb-section[data-sec="build"]')).toHaveClass(/open/);
    await expect(page.locator('.tb-section[data-sec="charts"]')).not.toHaveClass(/open/);
    expect(await page.evaluate(() => localStorage.getItem('navaid.sec.charts'))).toBe('0');
    expect(await page.evaluate(() => localStorage.getItem('navaid.sec.build'))).toBe('1');
  });

  test('closing the currently-open section does not open any other', async ({ page }) => {
    await boot(page);
    // Open Build first.
    await page.locator('.tb-section[data-sec="build"] .tb-section-head').click();
    await expect(page.locator('.tb-section[data-sec="build"]')).toHaveClass(/open/);

    // Click it again — should close, others stay closed.
    await page.locator('.tb-section[data-sec="build"] .tb-section-head').click();
    await expect(page.locator('.tb-section[data-sec="build"]')).not.toHaveClass(/open/);

    const openCount = await page.locator('.tb-section.open').count();
    expect(openCount).toBe(0);
  });

  test('only one section can be open at a time after a sequence of clicks', async ({ page }) => {
    await boot(page);
    for (const sec of ['build', 'view', 'charts', 'export']) {
      await page.locator(`.tb-section[data-sec="${sec}"] .tb-section-head`).click();
    }
    const openSecs = await page.locator('.tb-section.open').evaluateAll(
      els => els.map(e => e.getAttribute('data-sec')));
    expect(openSecs).toEqual(['export']);
  });
});
