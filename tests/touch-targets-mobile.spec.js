// @ts-check
// The 44px touch-target rule, applied to the controls the earlier pass missed. An
// earlier round covered the zoom buttons and footer links; the hamburger — the only
// way to reach any menu on a phone — was still 42x21, the smallest target in the app
// sitting on its most-used control, and the coordinate readout (a button in disguise:
// "Click to go to coordinates") was 19px tall.
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 375, height: 812 } });

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function');
}

const box = (page, sel) => page.evaluate(s => {
  const r = document.querySelector(s).getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), right: r.right, left: r.left };
}, sel);

test('the mobile menu button is a full touch target', async ({ page }) => {
  await boot(page);
  const b = await box(page, '#toolbar-toggle');
  expect(b.w).toBeGreaterThanOrEqual(44);
  expect(b.h).toBeGreaterThanOrEqual(44);
});

test('the menu button still opens the menu at its new size', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const tb = document.getElementById('toolbar');
    const wasCollapsed = tb.classList.contains('collapsed');
    document.getElementById('toolbar-toggle').click();
    return { wasCollapsed, nowCollapsed: tb.classList.contains('collapsed'),
      h: tb.getBoundingClientRect().height };
  });
  expect(r.nowCollapsed).not.toBe(r.wasCollapsed);
  expect(r.h).toBeGreaterThan(100);          // the sections are actually showing
});

test('the coordinate readout is tall enough to hit', async ({ page }) => {
  await boot(page);
  const b = await box(page, '#coord-readout');
  expect(b.h).toBeGreaterThanOrEqual(44);
});

test('the go-to editor has hittable fields and still fits the screen', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => document.getElementById('coord-readout').click());
  const r = await page.evaluate(() => {
    const el = document.getElementById('coord-readout');
    const rect = el.getBoundingClientRect();
    const fields = [...el.querySelectorAll('.goto-num')].map(i => Math.round(i.getBoundingClientRect().height));
    return { editing: el.classList.contains('editing'), fields,
      onScreen: rect.right <= window.innerWidth + 1 && rect.left >= -1,
      width: Math.round(rect.width) };
  });
  expect(r.editing).toBe(true);
  expect(r.fields.length).toBe(6);
  expect(Math.min(...r.fields)).toBeGreaterThanOrEqual(30);   // was a 22px row
  expect(r.onScreen).toBe(true);                              // vertical growth only
  expect(r.width).toBeLessThanOrEqual(375);
});

test('desktop is unaffected by the touch sizing', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page);
  const r = await page.evaluate(() => {
    const c = document.getElementById('coord-readout').getBoundingClientRect();
    const t = document.getElementById('toolbar-toggle');
    return { coordH: Math.round(c.height), toggleHidden: getComputedStyle(t).display === 'none' };
  });
  expect(r.toggleHidden).toBe(true);         // hamburger is mobile-only
  expect(r.coordH).toBeLessThan(44);         // desktop keeps the compact readout
});
