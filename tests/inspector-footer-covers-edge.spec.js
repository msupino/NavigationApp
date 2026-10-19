// @ts-check
// The inspector's pinned action buttons reach the panel's bottom edge: no strip under them where
// the rows scrolling beneath show through (reported on a phone in dark mode).
const { test, expect } = require('./_setup');

for (const theme of ['dark', 'light']) {
  test(`phone, ${theme}: nothing shows under the pinned buttons`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((t) => { try { localStorage.setItem('navaid.theme', t); } catch (e) {} }, theme);
    await page.goto('?lang=he&nogist');
    await page.waitForFunction(() => typeof showInspector === 'function');
    await page.evaluate(() => { state.waypoints = [{ lat: 31.86, lng: 35.22, name: 'ATAROT' }, { lat: 31.78, lng: 35.0, name: 'B' }];
      syncLegs(); draw(); state.selected = { type: 'wp', index: 0 }; showInspector(); });
    const gap = await page.evaluate(() => {
      const a = document.querySelector('#insp-body .insp-actions'), sc = document.getElementById('insp-body');
      sc.scrollTop = 0;
      return Math.round(sc.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
    });
    expect(gap).toBeLessThanOrEqual(1);
  });
}
