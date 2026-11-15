// @ts-check
// Reported from a phone in Hebrew: the hour in the top strip -- the button that opens the time
// slider -- was cut to ":00Z", half off the strip, because "English" beside the globe took the
// line's room. When the second line does not fit, the language switch steps down to its globe.
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

test('a wide phone keeps the language name beside the globe', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => document.querySelector('.deck-strip-clock'));
  if (!(await page.evaluate(() => document.body.classList.contains('deck-on')))) test.skip();
  expect(await page.evaluate(() => document.querySelector('.deck-strip').classList.contains('deck-strip-tight'))).toBe(false);
  await expect(page.locator('.deck-strip-lang .lang-quick-label')).toBeVisible();
});
