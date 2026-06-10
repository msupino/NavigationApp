// @ts-check
// Reporting-type overlay (issue #404): the IAA chart's סוג דיווח class
// (mandatory חובה / on-request דרישה) carried inline on nav-waypoints.json
// as `report`, surfaced as a map "M" badge + inspector row + View toggle.
const { test, expect } = require('./_setup');

async function boot(page, lang = 'en') {
  await page.addInitScript(() => {
    try {
      // One-time only: a reload must preserve what the test wrote (e.g. the
      // reporting toggle), so guard with a sentinel like the other specs.
      if (localStorage.getItem('__test_report_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_report_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=' + lang);
  await page.waitForFunction(() => typeof state !== 'undefined' && window.navWP);
}

test.describe('Reporting-type overlay (#404)', () => {
  test('reportingFor resolves inline report class by code', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => ({
      deror: reportingFor('DEROR'),
      mehol: reportingFor('MEHOL'),
      evlym: reportingFor('EVLYM'),
      frdis: reportingFor('FRDIS'),
      junk: reportingFor('ZZZZZ'),
    }));
    // DEROR / MEHOL = mandatory (חובה); EVLYM / FRDIS = on-request (דרישה).
    expect(out.deror).toBe('mandatory');
    expect(out.mehol).toBe('mandatory');
    expect(out.evlym).toBe('onRequest');
    expect(out.frdis).toBe('onRequest');
    expect(out.junk).toBeNull();
  });

  test('toggle is default-off, opt-in, and persists', async ({ page }) => {
    await boot(page);
    const cb = page.locator('#reporting-cb');
    await expect(cb).not.toBeChecked();
    expect(await page.evaluate(() => showReporting)).toBe(false);
    await cb.click();
    expect(await page.evaluate(() => showReporting)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('navaid.showReporting'))).toBe('1');
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && window.navWP);
    await expect(page.locator('#reporting-cb')).toBeChecked();
  });

  test('toggle lives in the on-map layers control', async ({ page }) => {
    await boot(page);
    const inCtl = await page.locator('#layers-control #reporting-cb').count();
    expect(inCtl).toBe(1);
  });

  test('inspector reporting row always shows (independent of the map toggle)', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.25722, lng: 34.89111, name: 'DEROR' },   // mandatory
        { lat: 32.0, lng: 34.8, name: 'FOO' },              // not a reporting point
      ];
      syncLegs(); draw();
    });
    // Map overlay is default-off, but the inspector row is informational and
    // shows regardless: mandatory waypoint gets the row.
    await page.evaluate(() => { state.selected = { type: 'wp', index: 0 }; showInspector(); });
    await expect(page.locator('#insp-body .reporting-badge-row')).toHaveCount(1);
    await expect(page.locator('#insp-body .reporting-badge-row')).toContainText(/Mandatory/i);
    // Non-reporting waypoint gets no row.
    await page.evaluate(() => { state.selected = { type: 'wp', index: 1 }; showInspector(); });
    await expect(page.locator('#insp-body .reporting-badge-row')).toHaveCount(0);
  });
});
