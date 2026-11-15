// @ts-check
// Reported from a phone in Hebrew: the hour in the top strip -- the button that opens the time
// slider -- was cut to ":00Z", half off the strip, because "English" beside the globe took the
// line's room. The switch is now the other language's name OR the globe, never both, and the same
// in English and Hebrew: the name when the line fits beside it in both, else the globe.
const { test, expect } = require('./_setup');

// At 390 px Chromium's monospace fits with no pixel to spare; the phone's own monospace is wider.
// 375 px (an iPhone mini or SE) is short by a few pixels here too.
for (const [lang, w] of [['he', 375], ['en', 375], ['he', 390]]) {
  test('the strip hour fits whole on a ' + w + ' px phone (' + lang + ')', async ({ page }) => {
    await page.setViewportSize({ width: w, height: 844 });
    await page.goto('?lang=' + lang + '&nogist');
    await page.waitForFunction(() => document.querySelector('.deck-strip-clock'));
    const r = await page.evaluate(() => {
      const line = document.querySelector('.deck-strip-sub');
      const sub = line.getBoundingClientRect();
      const btn = document.querySelector('.deck-strip-clock').getBoundingClientRect();
      const lang = document.querySelector('.deck-strip-lang');
      return { over: line.scrollWidth - line.clientWidth, sub: [sub.left, sub.right], btn: [btn.left, btn.right], label: lang.getAttribute('aria-label') };
    });
    expect(r.over, 'the line overflows its column: ' + JSON.stringify(r)).toBeLessThanOrEqual(1);
    expect(r.btn[0], JSON.stringify(r)).toBeGreaterThanOrEqual(r.sub[0] - 0.5);
    expect(r.btn[1], JSON.stringify(r)).toBeLessThanOrEqual(r.sub[1] + 0.5);
    // Globe alone or not, the switch still says what it does.
    expect(r.label).toBeTruthy();
  });
}

const look = (page) => page.evaluate(() => {
  const b = document.querySelector('.deck-strip-lang');
  const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
  return { name: vis(b.querySelector('.lang-quick-label')), globe: vis(b.querySelector('svg')) };
});

for (const w of [340, 375, 390, 430, 600]) {
  test('name or globe, never both, the same in both languages at ' + w + ' px', async ({ page }) => {
    await page.setViewportSize({ width: w, height: 844 });
    const seen = [];
    for (const lang of ['he', 'en']) {
      await page.goto('?lang=' + lang + '&nogist');
      await page.waitForFunction(() => document.querySelector('.deck-strip-clock'));
      const l = await look(page);
      expect(l.name !== l.globe, lang + ' ' + JSON.stringify(l)).toBe(true);
      seen.push(l.name);
    }
    expect(seen[0], 'Hebrew and English show the same kind of switch').toBe(seen[1]);
  });
}

test('a wide phone shows the language name', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => document.querySelector('.deck-strip-clock'));
  if (!(await page.evaluate(() => document.body.classList.contains('deck-on')))) test.skip();
  expect(await page.evaluate(() => document.querySelector('.deck-strip').classList.contains('deck-strip-tight'))).toBe(false);
  await expect(page.locator('.deck-strip-lang .lang-quick-label')).toBeVisible();
  await expect(page.locator('.deck-strip-lang svg')).toBeHidden();
});
