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
  // Fill the six DMS slots in one go.
  async function fillDMS(page, latD, latM, latS, lngD, lngM, lngS) {
    await page.locator('#goto-lat-d').fill(String(latD));
    await page.locator('#goto-lat-m').fill(String(latM));
    await page.locator('#goto-lat-s').fill(String(latS));
    await page.locator('#goto-lng-d').fill(String(lngD));
    await page.locator('#goto-lng-m').fill(String(lngM));
    await page.locator('#goto-lng-s').fill(String(lngS));
  }

  test('click turns the readout into DMS slots with fixed symbol separators', async ({ page }) => {
    await boot(page);
    await page.locator('#coord-readout').click();
    // Six editable numeric slots, each prefilled from the map centre.
    await expect(page.locator('#coord-readout .goto-num')).toHaveCount(6);
    await expect(page.locator('#goto-lat-d')).toBeVisible();
    expect(await page.locator('#goto-lat-d').inputValue()).toMatch(/^\d+$/);
    // The ° ′ ″ N E are static separators, not typed by the user.
    const seps = await page.locator('#coord-readout .goto-sep').allTextContents();
    const joined = seps.join('');
    expect(joined).toContain('°');
    expect(joined).toContain('″');
    expect(joined).toContain('N');
    expect(joined).toContain('E');
  });

  test('Enter pans the map to the typed point and drops a temp marker', async ({ page }) => {
    await boot(page);
    await page.locator('#coord-readout').click();
    await fillDMS(page, 32, 0, 17, 34, 43, 38);
    await page.locator('#goto-lng-s').press('Enter');
    const center = await page.evaluate(() => {
      const c = map.getCenter();
      return { lat: c.lat, lng: c.lng };
    });
    expect(center.lat).toBeCloseTo(32.00472, 2);
    expect(center.lng).toBeCloseTo(34.72722, 2);
    expect(await page.evaluate(() => window.hasGotoMarker())).toBe(true);
    // The marker is decorative, not a route waypoint.
    expect(await page.evaluate(() => state.waypoints.length)).toBe(0);
    // Editing finished — slots are gone.
    await expect(page.locator('#coord-readout .goto-num')).toHaveCount(0);
  });

  test('out-of-bbox input flags an error and keeps the field open', async ({ page }) => {
    await boot(page);
    const before = await page.evaluate(() => {
      const c = map.getCenter(); return { lat: c.lat, lng: c.lng };
    });
    await page.locator('#coord-readout').click();
    // 51N 0E — London, outside the Israel bbox.
    await fillDMS(page, 51, 0, 0, 0, 0, 0);
    await page.locator('#goto-lng-s').press('Enter');
    await expect(page.locator('#coord-readout')).toHaveClass(/error/);
    await expect(page.locator('#goto-lat-d')).toBeVisible();
    const after = await page.evaluate(() => {
      const c = map.getCenter(); return { lat: c.lat, lng: c.lng };
    });
    expect(after.lat).toBeCloseTo(before.lat, 5);
    expect(after.lng).toBeCloseTo(before.lng, 5);
  });

  test('Escape cancels editing without moving the map', async ({ page }) => {
    await boot(page);
    await page.locator('#coord-readout').click();
    await expect(page.locator('#goto-lat-d')).toBeVisible();
    await page.locator('#goto-lat-d').press('Escape');
    await expect(page.locator('#coord-readout .goto-num')).toHaveCount(0);
    await expect(page.locator('#coord-readout')).toHaveClass(/show/);
  });

  test('pasting a full coordinate fills every slot at once', async ({ page }) => {
    await boot(page);
    await page.locator('#coord-readout').click();
    // Fire a real paste event carrying a DMS string into the first slot.
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text', '32°00\'17"N 34°43\'38"E');
      document.getElementById('goto-lat-d').dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    const vals = await page.evaluate(() => ({
      latD: document.getElementById('goto-lat-d').value,
      latM: document.getElementById('goto-lat-m').value,
      latS: document.getElementById('goto-lat-s').value,
      lngD: document.getElementById('goto-lng-d').value,
      lngM: document.getElementById('goto-lng-m').value,
      lngS: document.getElementById('goto-lng-s').value,
    }));
    expect(vals).toEqual({ latD: '32', latM: '00', latS: '17', lngD: '034', lngM: '43', lngS: '38' });
    // Committing the pasted value pans there.
    await page.locator('#goto-lng-s').press('Enter');
    const center = await page.evaluate(() => {
      const c = map.getCenter(); return { lat: c.lat, lng: c.lng };
    });
    expect(center.lat).toBeCloseTo(32.00472, 2);
    expect(center.lng).toBeCloseTo(34.72722, 2);
  });

  test('a map click dismisses the temp marker', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.dropGotoMarker(32.0, 34.9));
    expect(await page.evaluate(() => window.hasGotoMarker())).toBe(true);
    await page.evaluate(() => map.fire('click', { latlng: L.latLng(32.1, 34.8) }));
    expect(await page.evaluate(() => window.hasGotoMarker())).toBe(false);
  });
});
