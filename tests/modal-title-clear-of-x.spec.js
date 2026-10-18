// @ts-check
// Reported: "X to close mixes with text" -- the satellite view's title (LLMZ / מצדה - coords) ran
// under the corner X on a Hebrew phone. A modal title keeps clear of its X, and stays centred.
const { test, expect } = require('./_setup');

for (const lang of ['he', 'en']) {
  test(`${lang}: a long modal title does not run under the close X (phone)`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('?lang=' + lang + '&nogist');
    await page.waitForFunction(() => typeof showSatellitePreviewModal === 'function');
    await page.evaluate(() => showSatellitePreviewModal({ lat: 31.33, lng: 35.388 },
      'LLMZ / מצדה'));
    const g = await page.evaluate(() => {
      const box = [...document.querySelectorAll('.modal')].pop();
      const t = box.querySelector(':scope > .modal-title'), x = box.querySelector('.modal-close-x');
      // The text's own box, not the element's: a range over the title's contents.
      const r = document.createRange(); r.selectNodeContents(t);
      const rects = [...r.getClientRects()], xr = x.getBoundingClientRect();
      return { overlap: rects.some(a => a.left < xr.right && a.right > xr.left && a.top < xr.bottom && a.bottom > xr.top),
        align: getComputedStyle(t).textAlign };
    });
    expect(g.overlap).toBe(false);
    expect(g.align).toBe('center');
  });
}
