// #674 — kneeboard nav-log PDF: the Nav log button opens a print-ready
// window with a header, the per-leg table, and a frequency list.
const { test, expect } = require('@playwright/test');

test('Nav log opens a printable document with header, table and freqs', async ({ page, context }) => {
  await page.addInitScript(() => {
    try { for (const s of ['build', 'view', 'display', 'charts', 'export', 'print']) {
      localStorage.setItem('navaid.sec.' + s, '1');
    } } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof showFlightPlan === 'function');
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'LLSD' },
                       { lat: 32.4, lng: 35.0, name: 'LLHA' }];
    state.notes = [{ lat: 32.2, lng: 34.9, text: '', shape: 'rect', color: '#ffd84a',
                     cc: 'LLSD', freqName: 'TLV', freq: '118.40' }];
    syncLegs(); draw(); showFlightPlan();
  });
  // Stub print so headless doesn't block, then click Nav log and grab the popup.
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.evaluate(() => {
      const b = [...document.querySelectorAll('.modal-btns button')]
        .find(x => /Nav log/i.test(x.textContent));
      b.click();
    }),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  const txt = await popup.evaluate(() => document.body.innerText);
  expect(txt).toContain('LLSD');
  expect(txt).toContain('LLHA');
  expect(txt).toContain('Frequencies');
  expect(txt).toContain('118.40');
  expect(await popup.locator('table.flight-table').count()).toBeGreaterThan(0);
});
