// @ts-check
// Opening the legend key (or a chart/plate window) over the map dismisses the point inspector
// rather than stacking on it.
const { test, expect } = require('./_setup');

async function openInspector(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function' && typeof showInspector === 'function'
    && document.getElementById('legend-toggle'));
  await page.evaluate(() => {
    const b = document.getElementById('boot-loading'); if (b) b.remove();
    state.waypoints = [{ lat: 32.1, lng: 34.85, name: 'A' }, { lat: 32.4, lng: 34.95, name: 'B' }];
    syncLegs(); draw(); state.selected = { type: 'wp', index: 0 }; showInspector();
  });
  await expect(page.locator('#inspector')).not.toHaveClass(/hidden/);
}
const inspHidden = page => page.evaluate(() => document.getElementById('inspector').classList.contains('hidden'));

test('opening the legend key closes the inspector', async ({ page }) => {
  await openInspector(page);
  // Legend starts collapsed; first click opens it.
  await page.evaluate(() => { if (!document.getElementById('map-legend').classList.contains('map-legend-collapsed')) window.setLegendCollapsed(true, false); });
  await page.locator('#legend-toggle').click();
  await expect.poll(() => inspHidden(page)).toBe(true);
  // The legend is open.
  await expect(page.locator('#map-legend')).not.toHaveClass(/map-legend-collapsed/);
});

test('collapsing the legend does not touch the inspector', async ({ page }) => {
  await openInspector(page);
  await page.evaluate(() => window.setLegendCollapsed(false, false));   // open it first
  // Re-select so the inspector is up with the legend already open.
  await page.evaluate(() => { state.selected = { type: 'wp', index: 0 }; showInspector(); });
  await expect(page.locator('#inspector')).not.toHaveClass(/hidden/);
  await page.locator('#legend-toggle').click();     // this collapses it
  await expect(page.locator('#map-legend')).toHaveClass(/map-legend-collapsed/);
  expect(await inspHidden(page)).toBe(false);        // collapsing left the inspector alone
});

test('opening the airport charts/plates window closes the inspector', async ({ page }) => {
  await openInspector(page);
  await page.evaluate(() => { if (typeof showChartsModal === 'function') showChartsModal(); });
  await expect(page.locator('.modal-back[data-chart-modal="airport-charts"]')).toHaveCount(1);
  await expect.poll(() => inspHidden(page)).toBe(true);
});

test('the companion freq-table panel leaves the inspector open', async ({ page }) => {
  await openInspector(page);
  await page.evaluate(() => { if (typeof showFreqTableModal === 'function') showFreqTableModal(); });
  await expect(page.locator('.modal-back[data-chart-modal="freq-table"]')).toHaveCount(1);
  expect(await inspHidden(page)).toBe(false);
});
