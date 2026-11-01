// @ts-check
// PageSpeed (mobile) measured a layout shift on boot: the map's edit column moved down once
// the phone layout (deck.js, body.deck-on) arrived in the loader's second phase. The layout
// a phone opens in has to be there for the first paint.
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 412, height: 823 }, hasTouch: true, isMobile: true });

test('a phone boots without the map column moving', async ({ page }) => {
  // A slow phone (or a CI runner) paints between the loader's scripts -- which is where the
  // column used to show in its desktop place before deck.js moved it. Throttle to see that.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    window.__cls = 0;
    window.__shifted = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__cls += e.value;
        for (const s of e.sources || []) window.__shifted.push(s.node && s.node.className);
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => document.body.classList.contains('deck-on') && window.NavAid && NavAid.followMe);
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({ cls: window.__cls, shifted: window.__shifted }));
  expect(r.shifted.filter(c => /edit-col-ctrl/.test(String(c)))).toEqual([]);
  expect(r.cls).toBeLessThan(0.01);
});
