// @ts-check
// Live coordinate readout (bottom-right map control).
//
// The box is always visible: it shows the map-centre coordinates by default,
// follows the cursor on map mousemove, and falls back to the centre on
// mouseout. As of issue #497 it is also an interactive "go to coordinates"
// control (see goto-latlng.spec.js). Pure UI — fires synthetic Leaflet events
// so the test does not depend on exact pixel→latlng projection.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof map !== 'undefined' &&
    typeof fmtLatLng === 'function' &&
    document.getElementById('coord-readout') !== null);
}

test.describe('Coordinate readout', () => {
  test('visible by default, showing the map-centre coordinates', async ({ page }) => {
    await boot(page);
    const box = page.locator('#coord-readout');
    await expect(box).toHaveClass(/show/);
    await expect(box).toHaveClass(/interactive/);
    const txt = await box.textContent();
    expect(txt).toContain('N');
    expect(txt).toContain('E');
  });

  test('shows DM-formatted lat/lng on mousemove, reverts to centre on mouseout', async ({ page }) => {
    await boot(page);
    const box = page.locator('#coord-readout');
    await page.evaluate(() => map.fire('mousemove', { latlng: L.latLng(32.5, 34.75) }));
    await expect(box).toHaveClass(/show/);
    const txt = await box.textContent();
    // 32.5 -> 32°30.0'N, 34.75 -> 34°45.0'E
    expect(txt).toContain('N');
    expect(txt).toContain('E');
    expect(txt).toContain('°');
    expect(txt).toContain("'");

    // mouseout no longer hides — it falls back to the map centre and stays shown.
    const expectedCenter = await page.evaluate(() => {
      map.fire('mouseout');
      const c = map.getCenter();
      return fmtLatLng(c.lat, 'N', 'S') + '  ' + fmtLatLng(c.lng, 'E', 'W');
    });
    await expect(box).toHaveClass(/show/);
    await expect(box).toHaveText(expectedCenter);
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
