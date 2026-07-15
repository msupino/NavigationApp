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

  test('minutes rounding to 60 carries into the degree (no 32°60.0)', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => ({
      hi: fmtLatLng(32.99997, 'N', 'S'),   // was 32°60.0'N
      exact: fmtLatLng(33.0, 'N', 'S'),
      lng: fmtLatLng(34.999999, 'E', 'W'), // was 34°60.0'E
      normal: fmtLatLng(32.5, 'N', 'S'),
    }));
    expect(r.hi).toBe("33°00.0'N");
    expect(r.exact).toBe("33°00.0'N");
    expect(r.lng).toBe("035°00.0'E");   // longitude zero-padded to 3 degree digits
    expect(r.normal).toBe("32°30.0'N");
    // never emits a 60.0 minutes value
    for (const v of Object.values(r)) expect(v).not.toContain('60.0');
  });

  test('readout renders left-to-right even under the Hebrew RTL layout', async ({ page }) => {
    await page.goto('?lang=he');
    await page.waitForFunction(() =>
      typeof map !== 'undefined' && document.getElementById('coord-readout') !== null);
    const dir = await page.evaluate(() =>
      getComputedStyle(document.getElementById('coord-readout')).direction);
    expect(dir).toBe('ltr');   // hemisphere letters/values must not be bidi-reordered
  });
});
