// @ts-check
// Tests for the export-PNG options modal (PR #203): checkboxes for
// printing waypoints/airports and layer dropdown, defaults, restore.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_export_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_export_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof exportPNG === 'function');
}

test.describe('Export PNG options modal', () => {
  test('Modal opens with checkboxes off and layer defaulting to Navigation', async ({ page }) => {
    await boot(page);
    // Need a route so exportPNG doesn't NOP; the modal should show regardless.
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18060, lng: 34.83470, name: 'LLHZ' }, { lat: 32.80972, lng: 35.04389, name: 'LLHA' }];
      syncLegs(); draw();
    });
    await page.locator('#print').click();
    // Wait for the modal backdrop to appear.
    await page.locator('.modal-back').waitFor();
    // Title.
    expect(await page.locator('.modal-title').textContent()).toBe('Export PNG');
    // 4 checkboxes: Waypoint Names (on), Drift Lines (on), Nav WPs (off), Airfields (off).
    const cbs = page.locator('.modal input[type="checkbox"]');
    expect(await cbs.count()).toBe(4);
    expect(await cbs.nth(0).isChecked()).toBe(true);   // Waypoint Names default on
    expect(await cbs.nth(1).isChecked()).toBe(true);   // Drift Lines default on
    expect(await cbs.nth(2).isChecked()).toBe(false);  // Nav WPs
    expect(await cbs.nth(3).isChecked()).toBe(false);  // Airfields
    // Layer defaults to Navigation.
    const sel = page.locator('.modal select');
    expect(await sel.inputValue()).toBe('Navigation');
    // Buttons present.
    expect(await page.locator('.modal .modal-btns button').count()).toBe(2);
    // Cancel closes the modal.
    await page.locator('.modal .modal-cancel').click();
    await expect(page.locator('.modal-back')).toHaveCount(0);
  });

  test('Export with both checkboxes off uses Navigation layer', async ({ page }) => {
    await boot(page);
    await page.locator('#layer-select').selectOption('OpenStreetMap');
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18060, lng: 34.83470, name: 'LLHZ' }, { lat: 32.80972, lng: 35.04389, name: 'LLHA' }];
      syncLegs(); draw();
    });
    // Open modal, leave defaults, click Export.
    const dl = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();
    await page.locator('.modal .modal-btns button').first().click();
    const download = await dl;
    expect(download.suggestedFilename()).toMatch(/^navigation-.+\.png$/);
  });

  test('Live preview: modal defaults hide waypoints/airfields immediately', async ({ page }) => {
    await boot(page);
    // Turn waypoints and airfields on so we can verify the modal hides them.
    await page.evaluate(() => { showNavWP = true; showAirfields = true; draw(); });
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();
    // Default state applied: both should be false now.
    expect(await page.evaluate(() => showNavWP)).toBe(false);
    expect(await page.evaluate(() => showAirfields)).toBe(false);
  });

  test('Live preview: toggling checkbox updates the map immediately', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { showNavWP = false; showAirfields = false; draw(); });
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();
    const cbs = page.locator('.modal input[type="checkbox"]');
    // Check "Print Navigation Waypoints" (idx 2) → showNavWP becomes true.
    await cbs.nth(2).check();
    expect(await page.evaluate(() => showNavWP)).toBe(true);
    // Uncheck → showNavWP back to false.
    await cbs.nth(2).uncheck();
    expect(await page.evaluate(() => showNavWP)).toBe(false);
    // Check "Print Airfields" (idx 3) → showAirfields becomes true.
    await cbs.nth(3).check();
    expect(await page.evaluate(() => showAirfields)).toBe(true);
  });

  test('Cancel restores original waypoints/airfields state', async ({ page }) => {
    await boot(page);
    // Starting with both visible.
    await page.evaluate(() => { showNavWP = true; showAirfields = true; draw(); });
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();
    // Modal hides them (default). Toggle waypoints on (idx 2 = Nav WPs).
    await page.locator('.modal input[type="checkbox"]').nth(2).check();
    expect(await page.evaluate(() => showNavWP)).toBe(true);
    // Cancel → restore original (both true).
    await page.locator('.modal .modal-cancel').click();
    await expect(page.locator('.modal-back')).toHaveCount(0);
    expect(await page.evaluate(() => showNavWP)).toBe(true);
    expect(await page.evaluate(() => showAirfields)).toBe(true);
  });

  test('Cancel restores original layer', async ({ page }) => {
    await boot(page);
    await page.locator('#layer-select').selectOption('OpenStreetMap');
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18060, lng: 34.83470, name: 'LLHZ' }, { lat: 32.80972, lng: 35.04389, name: 'LLHA' }];
      syncLegs(); draw();
    });
    // Verify we're on OSM.
    expect(await page.locator('#layer-select').inputValue()).toBe('OpenStreetMap');
    // Open modal (defaults to Navigation), then Cancel.
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();
    await page.locator('.modal .modal-cancel').click();
    // Back to OSM.
    expect(await page.locator('#layer-select').inputValue()).toBe('OpenStreetMap');
  });

  test('X button closes modal and restores original state', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { showNavWP = true; draw(); });
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();
    // Toggle waypoints off in the modal (idx 1 = Nav WPs).
    await page.locator('.modal input[type="checkbox"]').nth(1).uncheck();
    expect(await page.evaluate(() => showNavWP)).toBe(false);
    // Click ✕ close button.
    await page.locator('.modal-close-x').click();
    await expect(page.locator('.modal-back')).toHaveCount(0);
    // Original state restored.
    expect(await page.evaluate(() => showNavWP)).toBe(true);
  });

  test('Warns when no page size (A3/A4) is selected', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18060, lng: 34.83470, name: 'LLHZ' }, { lat: 32.80972, lng: 35.04389, name: 'LLHA' }];
      syncLegs(); draw();
    });
    // Ensure no page frame is active.
    await page.evaluate(() => { pageSize = null; });
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();
    await expect(page.locator('.modal-back').getByText(/no page size/i)).toBeVisible();
    await page.locator('.modal .modal-cancel').click();
    await expect(page.locator('.modal-back')).toHaveCount(0);

    // Select A3 and reopen — warning should be gone.
    await page.locator('#page-a3').click();
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();
    await expect(page.locator('.modal-back').getByText(/no page size/i)).not.toBeVisible();
    await page.locator('.modal .modal-cancel').click();
  });

  test.describe('PNG DPI metadata (pHYs chunk)', () => {
    async function exportPng(page) {
      const dl = page.waitForEvent('download', { timeout: 30000 });
      await page.locator('#print').click();
      await page.locator('.modal-back').waitFor();
      await page.locator('.modal .modal-btns button').first().click();
      const download = await dl;
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      return Buffer.concat(chunks);
    }

    // CRC-32 for PNG validation (same polynomial as the app).
    function pngCrc(data) {
      const table = new Int32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
      }
      let c = 0xFFFFFFFF;
      for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
      return (c ^ 0xFFFFFFFF) >>> 0;
    }

    // Walks all PNG chunks, verifies every CRC, and reads pHYs ppmX.
    function readPng(buf) {
      const view = new DataView(buf.buffer);
      // Verify PNG signature.
      expect(view.getUint32(0)).toBe(0x89504E47);
      expect(view.getUint32(4)).toBe(0x0D0A1A0A);
      let off = 8;
      let lastType = '';
      let ppmX = null;
      while (off + 8 < buf.byteLength) {
        if (off + 12 > buf.byteLength) throw new Error('Truncated chunk header at offset ' + off);
        const len = view.getUint32(off);
        if (off + 12 + len > buf.byteLength) throw new Error('Chunk data exceeds file at offset ' + off);
        const type = String.fromCharCode(view.getUint8(off + 4), view.getUint8(off + 5),
                                           view.getUint8(off + 6), view.getUint8(off + 7));
        // Verify chunk CRC.
        const crcData = new Uint8Array(buf.buffer, off + 4, 4 + len);
        const storedCrc = view.getUint32(off + 8 + len);
        expect(pngCrc(crcData)).toBe(storedCrc);
        if (type === 'pHYs') ppmX = view.getUint32(off + 8);
        lastType = type;
        off += 12 + len;
      }
      // File must end at IEND.
      expect(lastType).toBe('IEND');
      expect(off).toBe(buf.byteLength);
      return ppmX;
    }

    test('No page frame → no pHYs chunk', async ({ page }) => {
      await boot(page);
      await page.evaluate(() => {
        state.waypoints = [{ lat: 32.18060, lng: 34.83470, name: 'LLHZ' }, { lat: 32.80972, lng: 35.04389, name: 'LLHA' }];
        syncLegs(); draw();
        pageSize = null;
      });
      const buf = await exportPng(page);
      expect(readPng(buf)).toBeNull();
    });

    test('A4 portrait → pHYs embedded (~11811 ppm ≈ 300 DPI)', async ({ page }) => {
      await boot(page);
      await page.evaluate(() => {
        state.waypoints = [{ lat: 32.18060, lng: 34.83470, name: 'LLHZ' }, { lat: 32.80972, lng: 35.04389, name: 'LLHA' }];
        syncLegs(); draw();
        pageSize = 'A4'; pageOrient = 'portrait';
      });
      const buf = await exportPng(page);
      const ppm = readPng(buf);
      expect(ppm).not.toBeNull();
      expect(ppm).toBeGreaterThan(4000);
    });

    test('A3 portrait → pHYs embedded', async ({ page }) => {
      await boot(page);
      await page.evaluate(() => {
        state.waypoints = [{ lat: 32.18060, lng: 34.83470, name: 'LLHZ' }, { lat: 32.80972, lng: 35.04389, name: 'LLHA' }];
        syncLegs(); draw();
        pageSize = 'A3'; pageOrient = 'portrait';
      });
      const buf = await exportPng(page);
      const ppm = readPng(buf);
      expect(ppm).not.toBeNull();
      expect(ppm).toBeGreaterThan(4000);
    });
  });

  test('Modal respects checkbox toggles and layer change', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18060, lng: 34.83470, name: 'LLHZ' }, { lat: 32.80972, lng: 35.04389, name: 'LLHA' }];
      syncLegs(); draw();
    });
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();
    // Toggle both checkboxes on, switch to CVFR.
    const cbs = page.locator('.modal input[type="checkbox"]');
    await cbs.nth(1).check();
    await cbs.nth(0).check();
    await page.locator('.modal select').selectOption('CVFR');
    expect(await cbs.nth(1).isChecked()).toBe(true);
    expect(await cbs.nth(0).isChecked()).toBe(true);
    expect(await page.locator('.modal select').inputValue()).toBe('CVFR');
    // Click Export and verify download triggers.
    const dl = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('.modal .modal-btns button').first().click();
    const download = await dl;
    expect(download.suggestedFilename()).toMatch(/^navigation-.+\.png$/);
  });
});
