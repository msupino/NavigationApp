// @ts-check
// The airfield inspector no longer duplicates the plate list — it shows a single
// "Airport charts" button that opens the Charts modal expanded to that airfield.
const { test, expect } = require('./_setup');

test('inspector charts button opens the Charts modal expanded to that airfield', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.charts', '1'); localStorage.setItem('navaid.showAirfields', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof showInspector === 'function');
  await page.evaluate(() => { if (airfields === null && typeof loadAirfields === 'function') return loadAirfields(); });

  // Pick an airfield that actually has plates; drop a waypoint there + select it.
  const icao = await page.evaluate(() => {
    const af = (airfields || []).find(a => a.plates && a.plates.length);
    if (!af) return null;
    state.waypoints = [{ lat: af.lat, lng: af.lng, name: af.name }];
    syncLegs();
    state.selected = { type: 'wp', index: 0 };
    showInspector();
    return af.name;
  });
  test.skip(!icao, 'no airfield with plates');

  // No plate chips in the inspector — just the charts button.
  await expect(page.locator('#insp-body .plate-row')).toHaveCount(0);
  const btn = page.locator('#insp-body .insp-charts-btn');
  await expect(btn).toBeVisible();
  await btn.click();

  // Charts modal opens with that airfield's section expanded.
  const section = page.locator(`.charts-airport[data-icao="${icao}"]`);
  await expect(section).toBeVisible();
  await expect(section.locator('.charts-airport-header')).toHaveClass(/open/);
  await expect(section.locator('.plate-row').first()).toBeVisible();
});
