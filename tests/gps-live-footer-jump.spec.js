// @ts-check
// The footer live-location button toggles its label between "show location" and
// "hide location". On the wrapped (mobile) footer those two labels are different
// widths — most visibly in Hebrew — which made the button (and the wrap after
// it) jump to another line on toggle and on the first i18n fill. A reserved
// per-language min-width keeps its width stable.
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 390, height: 844 } });

for (const lang of ['he', 'en']) {
  test(`the GPS buttons keep their whole labels and stay inside the card (${lang})`, async ({ page }) => {
    await page.goto(`?lang=${lang}`);
    await page.waitForFunction(() => document.getElementById('gps-record') && document.getElementById('gps-live'));
    const r = await page.evaluate(() => {
      const card = document.getElementById('toolbar').getBoundingClientRect();
      const one = (id) => {
        const el = document.getElementById(id);
        const t = el.querySelector('.footer-link-text');
        const b = el.getBoundingClientRect();
        return { top: Math.round(b.top), left: Math.round(b.left), right: Math.round(b.right),
                 clipped: t.scrollWidth > t.clientWidth + 1 };
      };
      return { rec: one('gps-record'), live: one('gps-live'),
               card: { left: Math.round(card.left), right: Math.round(card.right) } };
    });
    // Where a label does not fit beside its neighbour the button takes the next line WHOLE.
    // The two used to share a line by being cut short instead, which is the worse trade for
    // 'Show my location' / 'Start recording' in flight.
    for (const b of [r.rec, r.live]) {
      expect(b.clipped).toBe(false);
      expect(b.left).toBeGreaterThanOrEqual(r.card.left - 1);
      expect(b.right).toBeLessThanOrEqual(r.card.right + 1);
    }
  });

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
