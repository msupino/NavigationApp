// @ts-check
// Go-to coordinates (issue #497).
//
// The bottom-left coordinate readout is also a go-to input: click it to edit,
// type a coordinate in DMS / DM / decimal, press Enter to pan the map there
// and drop a temporary "look here" marker that is NOT part of the route.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof map !== 'undefined' &&
    typeof parseLatLng === 'function' &&
    typeof window.hasGotoMarker === 'function' &&
    document.getElementById('coord-readout') !== null);
}

test.describe('parseLatLng', () => {
  test('parses DMS with hemisphere letters', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => parseLatLng('32°00\'17"N 34°43\'38"E'));
    expect(r.lat).toBeCloseTo(32.00472, 4);
    expect(r.lng).toBeCloseTo(34.72722, 4);
  });

  test('parses degrees + decimal minutes (DM)', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => parseLatLng("32°30.0'N 34°45.0'E"));
    expect(r.lat).toBeCloseTo(32.5, 4);
    expect(r.lng).toBeCloseTo(34.75, 4);
  });

  test('parses plain decimal degrees, comma or space separated', async ({ page }) => {
    await boot(page);
    const a = await page.evaluate(() => parseLatLng('32.005, 34.727'));
    const b = await page.evaluate(() => parseLatLng('32.005 34.727'));
    expect(a).toEqual(b);
    expect(a.lat).toBeCloseTo(32.005, 3);
    expect(a.lng).toBeCloseTo(34.727, 3);
  });

  test('rejects junk and coordinates outside the Israel-area bbox', async ({ page }) => {
    await boot(page);
    const cases = await page.evaluate(() => [
      parseLatLng(''),
      parseLatLng('hello'),
      parseLatLng('99, 99'),          // out of bbox
      parseLatLng('0, 0'),            // out of bbox
      parseLatLng('51.5N 0.1W'),      // London — out of bbox
    ]);
    for (const c of cases) expect(c).toBeNull();
  });
});

test.describe('go-to input', () => {
  test('click turns the readout into an input prefilled with the centre', async ({ page }) => {
    await boot(page);
    await page.locator('#coord-readout').click();
    const input = page.locator('#goto-input');
    await expect(input).toBeVisible();
    const val = await input.inputValue();
    expect(val).toMatch(/N/);
    expect(val).toMatch(/E/);
    expect(val).toMatch(/"/);   // DMS prefill includes seconds
  });

  test('Enter pans the map to the typed point and drops a temp marker', async ({ page }) => {
    await boot(page);
    await page.locator('#coord-readout').click();
    const input = page.locator('#goto-input');
    await input.fill('32°00\'17"N 34°43\'38"E');
    await input.press('Enter');
    const center = await page.evaluate(() => {
      const c = map.getCenter();
      return { lat: c.lat, lng: c.lng };
    });
    expect(center.lat).toBeCloseTo(32.00472, 2);
    expect(center.lng).toBeCloseTo(34.72722, 2);
    expect(await page.evaluate(() => window.hasGotoMarker())).toBe(true);
    // The marker is decorative, not a route waypoint.
    expect(await page.evaluate(() => state.waypoints.length)).toBe(0);
    // Editing finished — input is gone.
    await expect(page.locator('#goto-input')).toHaveCount(0);
  });

  test('invalid input flags an error and keeps the field open', async ({ page }) => {
    await boot(page);
    const before = await page.evaluate(() => {
      const c = map.getCenter(); return { lat: c.lat, lng: c.lng };
    });
    await page.locator('#coord-readout').click();
    const input = page.locator('#goto-input');
    await input.fill('not a coordinate');
    await input.press('Enter');
    await expect(page.locator('#coord-readout')).toHaveClass(/error/);
    await expect(input).toBeVisible();
    const after = await page.evaluate(() => {
      const c = map.getCenter(); return { lat: c.lat, lng: c.lng };
    });
    expect(after.lat).toBeCloseTo(before.lat, 5);
    expect(after.lng).toBeCloseTo(before.lng, 5);
  });

  test('Escape cancels editing without moving the map', async ({ page }) => {
    await boot(page);
    await page.locator('#coord-readout').click();
    await expect(page.locator('#goto-input')).toBeVisible();
    await page.locator('#goto-input').press('Escape');
    await expect(page.locator('#goto-input')).toHaveCount(0);
    await expect(page.locator('#coord-readout')).toHaveClass(/show/);
  });

  test('a map click dismisses the temp marker', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.dropGotoMarker(32.0, 34.9));
    expect(await page.evaluate(() => window.hasGotoMarker())).toBe(true);
    await page.evaluate(() => map.fire('click', { latlng: L.latLng(32.1, 34.8) }));
    expect(await page.evaluate(() => window.hasGotoMarker())).toBe(false);
  });
});
