// @ts-check
// The footer live-location button toggles its label between "show location" and
// "hide location". On the wrapped (mobile) footer those two labels are different
// widths — most visibly in Hebrew — which made the button (and the wrap after
// it) jump to another line on toggle and on the first i18n fill. A reserved
// per-language min-width keeps its width stable.
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 390, height: 844 } });

for (const lang of ['he', 'en']) {
  test(`gps-live footer button keeps a stable width across show/hide (${lang})`, async ({ page }) => {
    await page.goto(`?lang=${lang}`);
    await page.waitForFunction(() => document.getElementById('gps-live') && typeof S !== 'undefined');
    const r = await page.evaluate(() => {
      const el = document.getElementById('gps-live');
      const sp = el.querySelector('.footer-link-text');
      sp.textContent = S.tbGpsLive;      // "show location"
      const a = el.getBoundingClientRect();
      sp.textContent = S.tbGpsLiveStop;  // "hide location"
      const b = el.getBoundingClientRect();
      return { wShow: Math.round(a.width), wHide: Math.round(b.width),
               topShow: Math.round(a.top), topHide: Math.round(b.top) };
    });
    expect(r.wShow).toBe(r.wHide);     // width doesn't change with the label
    expect(r.topShow).toBe(r.topHide); // so it never jumps to another line
  });
}
