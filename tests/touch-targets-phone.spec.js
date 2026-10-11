// @ts-check
// Three phone controls that were under the 44px touch minimum (UX review): the attribution
// toggle (drawn 30px tall, tap area now 44 upward), Comm fail on a 360px phone where it is icon-only
// (36 wide), and the safety notice's language picker (32 tall).
const { test, expect } = require('./_setup');
test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

test('attribution toggle, narrow Comm fail and the notice language picker reach 44px', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof NavAid !== 'undefined' && NavAid.disclaimerDone);
  const r = await page.evaluate(() => {
    const box = (sel) => { const e = document.querySelector(sel); const b = e.getBoundingClientRect(); return { w: b.width, h: b.height, e, b }; };
    const at = box('.attrib-toggle');
    // The tap area grows upward (the bottom bar is right under it): a touch 13px above the
    // drawn button still lands on it, for 44px in all.
    const hits = [-6, -13].map(d => { const h = document.elementFromPoint(at.b.left + at.w / 2, at.b.top + d); return !!h && at.e.contains(h); });
    const cf = box('.deck-strip-commfail');
    NavAid.showDisclaimer();
    const ls = box('.disclaimer-lang-select');
    return { hits, cf: [cf.w, cf.h], ls: ls.h };
  });
  expect(r.hits).toEqual([true, true]);
  expect(r.cf[0]).toBeGreaterThanOrEqual(44);
  expect(r.cf[1]).toBeGreaterThanOrEqual(44);
  expect(r.ls).toBeGreaterThanOrEqual(44);
});
