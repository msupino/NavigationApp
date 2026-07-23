// @ts-check
// In light mode the A3/A4 page-size buttons signal "selected" only via
// aria-pressed (they have no .tool class), and the light-theme active rule used
// to match only `button.tool.active` — so a selected page button rendered as
// plain white with no visible selected state. It must show the blue highlight.
const { test, expect } = require('./_setup');

const BLUE = 'rgb(29, 111, 224)';   // #1d6fe0

async function boot(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.theme', 'light'); } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof setPage === 'function' && document.body.classList.contains('theme-light'));
}

test('selected A3 page button is highlighted in light mode', async ({ page }) => {
  await boot(page);
  const bg = await page.evaluate(() => {
    setPage('A3');
    const b = document.getElementById('page-a3');
    return getComputedStyle(b).backgroundColor;
  });
  expect(bg).toBe(BLUE);
});

test('selected A4 page button is highlighted in light mode', async ({ page }) => {
  await boot(page);
  const bg = await page.evaluate(() => {
    setPage('A4');
    const b = document.getElementById('page-a4');
    return getComputedStyle(b).backgroundColor;
  });
  expect(bg).toBe(BLUE);
});

test('hovering a selected page button keeps a solid fill (not white-on-white)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });   // desktop hover rules
  await boot(page);
  // Open the Print section so the page buttons are interactable.
  await page.evaluate(() => {
    const h = document.querySelector('[data-sec="print"] .tb-section-head');
    if (h && h.parentElement.dataset.open !== '1') h.click();
  });
  await page.evaluate(() => setPage('A3'));
  await page.locator('#page-a3').hover({ force: true });
  const s = await page.evaluate(() => {
    const c = getComputedStyle(document.getElementById('page-a3'));
    return { bg: c.backgroundColor, color: c.color };
  });
  // White text → the background must stay opaque blue, not a translucent wash.
  expect(s.color).toBe('rgb(255, 255, 255)');
  expect(s.bg).toBe('rgb(25, 95, 194)');     // #195fc2, fully opaque
});

test('modal close (×) stays readable on hover in light mode', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await boot(page);
  // Any modal with a close-X exercises the shared light-theme hover style; the
  // keyboard-shortcuts help modal opens with no route/page-frame preconditions.
  await page.locator('#help-trigger').click();
  await page.locator('.modal-back').waitFor();
  const x = page.locator('.modal-close-x').first();
  await x.hover({ force: true });
  const s = await x.evaluate(node => {
    const c = getComputedStyle(node);
    return { color: c.color, bg: c.backgroundColor };
  });
  // Light hover: dark text on a pale wash — not the dark-theme #443f3f leftover.
  expect(s.color).toBe('rgb(17, 24, 32)');             // #111820
  expect(s.bg).toBe('rgba(29, 111, 224, 0.08)');       // pale, not dark grey
});

test('unselected page button is not highlighted in light mode', async ({ page }) => {
  await boot(page);
  const bg = await page.evaluate(() => {
    setPage('A3');                                   // A3 on, A4 off
    return getComputedStyle(document.getElementById('page-a4')).backgroundColor;
  });
  expect(bg).not.toBe(BLUE);                         // stays white/neutral
});
