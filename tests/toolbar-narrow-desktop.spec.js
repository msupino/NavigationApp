// @ts-check
// At desktop widths the floating menu bar is a horizontal pill. On a narrow
// desktop the section heads used to run off the right edge and vanish (overflow
// is visible for the dropdowns, so there's no scrollbar to reach them). The bar
// is now capped at the viewport width and wraps onto a second row instead.
const { test, expect } = require('./_setup');

async function boot(page, w, h = 800) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto('?lang=en');
  await page.waitForFunction(() => document.getElementById('toolbar'));
}

async function barState(page) {
  return page.evaluate(() => {
    const tb = document.getElementById('toolbar');
    const b = tb.getBoundingClientRect();
    const heads = [...tb.querySelectorAll('.tb-section-head')].map(e => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right };
    });
    return { right: b.right, left: b.left, height: b.height, vw: window.innerWidth, heads };
  });
}

test('narrow desktop: bar stays within the viewport and every section head is reachable', async ({ page }) => {
  await boot(page, 700);
  const s = await barState(page);
  expect(s.right).toBeLessThanOrEqual(s.vw + 0.5);   // no horizontal overflow
  expect(s.height).toBeGreaterThan(48);              // wrapped onto a 2nd row
  for (const h of s.heads) {
    expect(h.left).toBeGreaterThanOrEqual(-0.5);
    expect(h.right).toBeLessThanOrEqual(s.vw + 0.5); // fully on-screen
  }
});

test('wide desktop: bar stays a single row', async ({ page }) => {
  await boot(page, 1280);
  const s = await barState(page);
  expect(s.height).toBeLessThan(48);                 // one row
  expect(s.right).toBeLessThanOrEqual(s.vw + 0.5);
});

test('narrow desktop RTL: bar stays within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 });
  await page.goto('?lang=he');
  await page.waitForFunction(() => document.getElementById('toolbar'));
  const s = await barState(page);
  expect(s.left).toBeGreaterThanOrEqual(-0.5);
  expect(s.right).toBeLessThanOrEqual(s.vw + 0.5);
});
