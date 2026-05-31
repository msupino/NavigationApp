// @ts-check
// Live mouse-coordinate readout (bottom-left map control).
//
// On map mousemove the #coord-readout box shows the cursor lat/lng in the
// same DM format the inspector uses for waypoints (fmtLatLng), and hides
// again on mouseout. Pure UI control — fires synthetic Leaflet events so
// the test does not depend on exact pixel→latlng projection.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof map !== 'undefined' &&
    typeof fmtLatLng === 'function' &&
    document.getElementById('coord-readout') !== null);
}

test.describe('Mouse coordinate readout', () => {
  test('hidden until the cursor enters the map', async ({ page }) => {
    await boot(page);
    const box = page.locator('#coord-readout');
    await expect(box).toHaveClass(/coord-readout/);
    await expect(box).not.toHaveClass(/show/);
  });

  test('shows DM-formatted lat/lng on mousemove, hides on mouseout', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => map.fire('mousemove', { latlng: L.latLng(32.5, 34.75) }));
    const box = page.locator('#coord-readout');
    await expect(box).toHaveClass(/show/);
    const txt = await box.textContent();
    // 32.5 -> 32°30.0'N, 34.75 -> 34°45.0'E
    expect(txt).toContain('N');
    expect(txt).toContain('E');
    expect(txt).toContain('°');
    expect(txt).toContain("'");

    await page.evaluate(() => map.fire('mouseout'));
    await expect(box).not.toHaveClass(/show/);
  });

  test('readout text matches fmtLatLng for the cursor point', async ({ page }) => {
    await boot(page);
    const expected = await page.evaluate(() => {
      map.fire('mousemove', { latlng: L.latLng(31.25861, 34.76361) });
      return fmtLatLng(31.25861, 'N', 'S') + '  ' + fmtLatLng(34.76361, 'E', 'W');
    });
    await expect(page.locator('#coord-readout')).toHaveText(expected);
  });
});
