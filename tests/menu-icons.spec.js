// @ts-check
// UI/UX review (ui-ux-pro-max rules): the phone menu's section rows were 20px tall (touch
// minimum is 44pt / 48dp), the chrome used emoji as icons (font-dependent, ignores the theme),
// and the bottom bar had six items with an emergency action among the places.
const { test, expect } = require('./_setup');

const EMOJI = /\p{Extended_Pictographic}/u;

test('phone menu: every section is a row of at least 48px with a drawn icon and a hint', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => document.querySelector('.deck-btn-menu'));
  await page.evaluate(() => document.querySelector('.deck-btn-menu').click());
  await page.waitForSelector('#deck-sheet .tb-section-head');
  const rows = await page.evaluate(() => [...document.querySelectorAll('#deck-sheet .tb-section-head')]
    .filter(h => h.getBoundingClientRect().height > 0)
    .map(h => ({ h: Math.round(h.getBoundingClientRect().height), svg: !!h.querySelector('svg'),
      text: h.textContent })));
  expect(rows.length).toBeGreaterThanOrEqual(8);
  for (const r of rows) {
    expect(r.h, r.text).toBeGreaterThanOrEqual(48);
    expect(r.svg, r.text).toBe(true);
    expect(EMOJI.test(r.text), r.text).toBe(false);
  }
  const hints = await page.locator('#deck-sheet .tb-sec-hint:visible').count();
  expect(hints).toBeGreaterThanOrEqual(6);
});

test('phone bottom bar: five places, drawn icons; Comm fail is the red button in the strip', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => document.querySelector('#deck-bar'));
  const bar = await page.evaluate(() => [...document.querySelectorAll('#deck-bar .deck-btn')]
    .map(b => ({ key: b.dataset.deck, svg: !!b.querySelector('svg'), emoji: /\p{Extended_Pictographic}/u.test(b.textContent) })));
  expect(bar.map(b => b.key)).toEqual(['map', 'menu', 'plan', 'record', 'here']);
  expect(bar.every(b => b.svg && !b.emoji)).toBe(true);
  const comm = page.locator('#deck-strip .deck-strip-commfail');
  await expect(comm).toBeVisible();
  const box = await comm.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(36);
  expect(await comm.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(198, 47, 47)');
});

for (const width of [1280, 1440]) {
  test(`desktop ${width}px: the menubar keeps one row, and its sections carry icons, not emoji`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => document.querySelector('#toolbar .tb-section-head svg'));
    const out = await page.evaluate(() => ({
      h: Math.round(document.getElementById('toolbar').getBoundingClientRect().height),
      heads: [...document.querySelectorAll('#toolbar .tb-section-head')].map(h => ({
        svg: !!h.querySelector('svg'), emoji: /\p{Extended_Pictographic}/u.test(h.textContent) })),
    }));
    expect(out.h).toBeLessThan(45);                     // one row
    expect(out.heads.every(h => h.svg && !h.emoji)).toBe(true);
  });
}
