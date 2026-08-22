// @ts-check
const { test, expect } = require('./_setup');

test('history restoration keeps the language selector aligned with the page', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.locator('#lang-select').selectOption('en');
  await page.waitForURL(/lang=en/);
  await page.goBack();
  await expect(page).toHaveURL(/lang=he/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  await expect(page.locator('#lang-select')).toHaveValue('he');
});

test('flight-plan speed and altitude inputs have useful accessible names', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showFlightPlan === 'function');
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32, lng: 34.8, name: 'A' },
      { lat: 32.1, lng: 34.9, name: 'B' }];
    syncLegs();
    showReturn = true;
    showFlightPlan();
  });
  const tables = page.locator('.fp-scroll > .flight-table');
  await expect(tables.nth(0).locator('tbody .plan-num').nth(0))
    .toHaveAccessibleName('Leg speed 1');
  await expect(tables.nth(0).locator('tbody .plan-num').nth(1))
    .toHaveAccessibleName('Leg altitude 1');
  await expect(tables.nth(1).locator('tbody .plan-num').nth(0))
    .toHaveAccessibleName('Leg speed 1');
  await expect(tables.nth(1).locator('tbody .plan-num').nth(1))
    .toHaveAccessibleName('Leg altitude 1');
});

test('mobile boot does not shift controls while they are assembled', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => {
    window.__reviewCls = 0;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__reviewCls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => !document.documentElement.classList.contains('app-booting'));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__reviewCls)).toBeLessThan(0.1);
  await page.close();
});
