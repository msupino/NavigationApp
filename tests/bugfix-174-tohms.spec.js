// @ts-check
// Regression test for #174: toHMS extracts hours so totals >60 min display
// correctly. Before the fix toHMS(3) returned "180:00"; after, "3:00:00".
const { test, expect } = require('./_setup');

test.describe('#174 toHMS extracts hours', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?lang=en');
    await page.waitForFunction(() => typeof toHMS === 'function');
  });

  test('sub-hour stays mm:ss (backwards compatible)', async ({ page }) => {
    const out = await page.evaluate(() => ({
      half: toHMS(0.5),       // 30 min
      almost: toHMS(0.99),    // ~59 min 24s — rounds to 59:25
      quarter: toHMS(0.25),   // 15 min
    }));
    expect(out.half).toBe('30:00');
    expect(out.quarter).toBe('15:00');
    expect(out.half.split(':')).toHaveLength(2);  // mm:ss, not h:mm:ss
  });

  test('exactly 1 hour renders as 1:00:00', async ({ page }) => {
    const out = await page.evaluate(() => toHMS(1));
    expect(out).toBe('1:00:00');
  });

  test('multi-hour totals extract hours: toHMS(3) → "3:00:00" (#174)', async ({ page }) => {
    const out = await page.evaluate(() => toHMS(3));
    expect(out).toBe('3:00:00');
    expect(out).not.toBe('180:00');         // pre-fix output
  });

  test('toHMS(2.5) renders as 2:30:00', async ({ page }) => {
    const out = await page.evaluate(() => toHMS(2.5));
    expect(out).toBe('2:30:00');
  });

  test('toHMS(1.25) renders as 1:15:00', async ({ page }) => {
    const out = await page.evaluate(() => toHMS(1.25));
    expect(out).toBe('1:15:00');
  });
});
