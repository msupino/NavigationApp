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

test('phone: Export wears its neighbours\' face -- centred and bordered -- and still opens its list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?lang=en&nogist');
  await page.evaluate(() => document.querySelector('.deck-btn-menu').click());
  await page.locator('.tb-section[data-sec="export"] .tb-section-head').click();
  const g = await page.evaluate(() => {
    const wrap = document.querySelector('#deck-sheet .mi-select');
    const face = wrap.querySelector('.mi-face').getBoundingClientRect();
    const w = wrap.getBoundingClientRect(), btn = document.getElementById('route-library').getBoundingClientRect();
    return { faceMid: (face.left + face.right) / 2, wrapMid: (w.left + w.right) / 2, h: w.height, btnH: btn.height,
      border: getComputedStyle(wrap).borderTopWidth, text: wrap.querySelector('.mi-face').textContent };
  });
  expect(Math.abs(g.faceMid - g.wrapMid)).toBeLessThan(30);   // centred, icon and chevron either side
  expect(g.h).toBe(g.btnH);
  expect(g.border).toBe('1px');
  expect(g.text).toBe('Export');
  await expect(page.locator('#export-select')).toBeEnabled();
});

for (const width of [390, 1280]) {
  test(`${width}px: a slider's value and its reset never part from the slider's row`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('?lang=en&nogist');
    if (width < 700) await page.evaluate(() => document.querySelector('.deck-btn-menu').click());
    await page.locator('.tb-section[data-sec="display"] .tb-section-head').click();
    const rows = await page.evaluate(() => [...document.querySelectorAll('.tb-section[data-sec="display"] .navtoggle-slider')]
      .filter(r => r.getClientRects().length).map(r => {
        const mid = e => { const b = e.getBoundingClientRect(); return (b.top + b.bottom) / 2; };
        const val = r.querySelector('.slider-val'), reset = r.querySelector('.slider-reset');
        return { id: r.querySelector('input[type=range]').id, val: mid(val), reset: reset ? mid(reset) : mid(val),
          label: mid(r.querySelector('span')) };
      }));
    expect(rows.length).toBeGreaterThan(3);
    for (const r of rows) {
      expect(Math.abs(r.reset - r.val), r.id).toBeLessThan(6);     // the ↻ stays with its value
      expect(Math.abs(r.val - r.label), r.id).toBeLessThan(6);     // ...on the label's line
    }
  });
}
