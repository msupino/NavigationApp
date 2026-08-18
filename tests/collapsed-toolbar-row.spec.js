// @ts-check
// The closed menu card on a phone: the drag handle, the ☰ and the language picker belong on
// ONE row. As flex items they wrapped as soon as a platform's font made the picker a few
// pixels wider than the card's cap — reported from a real phone, where the language sat on a
// line of its own and a closed menu was three rows tall. They are grid columns now, so the
// row cannot break; a tight card shrinks the picker's column instead.
//
// And the two GPS buttons below must not be trimmed: 'Show my location' arriving as
// 'Show my...' is exactly the wrong thing to be ambiguous about in flight.
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 390, height: 780 }, hasTouch: true });

async function collapsed(page, lang) {
  await page.goto(`?lang=${lang}&nogist`);
  await page.waitForSelector('#toolbar');
  await page.evaluate(() => document.getElementById('toolbar').classList.add('collapsed'));
  return page.evaluate(() => {
    const top = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().top);
    const clip = (sel) => {
      const el = document.querySelector(sel + ' .footer-link-text') || document.querySelector(sel);
      return { text: el.textContent.trim(), clipped: el.scrollWidth > el.clientWidth + 1 };
    };
    const card = document.getElementById('toolbar').getBoundingClientRect();
    return {
      handle: top('#toolbar-handle'), toggle: top('#toolbar-toggle'), lang: top('#lang-toggle'),
      links: top('#footer-links'),
      live: clip('#gps-live'), rec: clip('#gps-record'), sim: clip('#sim-trigger'),
      card: { left: Math.round(card.left), right: Math.round(card.right) },
      simBox: document.querySelector('#sim-trigger').getBoundingClientRect(),
    };
  });
}

for (const lang of ['en', 'he']) {
  test(`${lang}: the hamburger and the language picker share a row`, async ({ page }) => {
    const m = await collapsed(page, lang);
    // Same row: their tops sit within one line box of each other, and both are above the links.
    expect(Math.abs(m.lang - m.toggle)).toBeLessThan(20);
    expect(Math.abs(m.handle - m.toggle)).toBeLessThan(20);
    expect(m.links).toBeGreaterThan(m.toggle + 20);
  });

  test(`${lang}: the GPS buttons show their whole label`, async ({ page }) => {
    const m = await collapsed(page, lang);
    expect(m.live.text.length).toBeGreaterThan(3);
    expect(m.live.clipped).toBe(false);
    expect(m.rec.clipped).toBe(false);
    expect(m.live.text).not.toContain('…');
    expect(m.rec.text).not.toContain('…');
  });

  test(`${lang}: the simulator button stays inside the card`, async ({ page }) => {
    const m = await collapsed(page, lang);
    expect(Math.round(m.simBox.left)).toBeGreaterThanOrEqual(m.card.left - 1);
    expect(Math.round(m.simBox.right)).toBeLessThanOrEqual(m.card.right + 1);
  });
}

// A picker that a platform's font renders far wider than ours must still not break the row.
test('an oversized language picker shrinks instead of wrapping', async ({ page }) => {
  const m = await collapsed(page, 'en');
  const after = await page.evaluate(() => {
    const sel = document.getElementById('lang-select');
    sel.style.fontSize = '24px';                    // a phone with a large system font
    sel.style.minWidth = '160px';
    const top = (s) => Math.round(document.querySelector(s).getBoundingClientRect().top);
    return { toggle: top('#toolbar-toggle'), lang: top('#lang-toggle'), links: top('#footer-links') };
  });
  expect(Math.abs(after.lang - after.toggle)).toBeLessThan(24);
  expect(after.links).toBeGreaterThan(after.toggle + 20);
  expect(m.links).toBeGreaterThan(0);
});
