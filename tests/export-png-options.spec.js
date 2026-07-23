// @ts-check
// Tests for the inline export/print options panel, hosted in the Print toolbar
// section (#export-panel): checkboxes for printing waypoints/airfields, the
// layer dropdown, defaults, and map-state restore when the section closes.
const { test, expect } = require('./_setup');
const { pairLLHZ_LLHA } = require('./_airfieldArp');

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
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof exportPNG === 'function'
    && typeof openExportPanel === 'function');
}

// Open the inline export panel (builds it + its live preview) and wait until
// the Export button is present.
async function openPanel(page) {
  await page.evaluate(() => openExportPanel());
  await page.locator('#export-panel .export-panel-btns button').first().waitFor();
}

// Close the Print section: tears down the panel and restores the map state.
async function closePanel(page) {
  await page.evaluate(() => closeToolbarMenus());
}

test.describe('Export PNG options panel', () => {
  // PNG export waits on map tiles + canvas; default 15s is too tight for
  // waitForEvent('download', { timeout: 30_000 }) locally and on CI.
  test.describe.configure({
    timeout: process.env.EXPECTED_SHA ? 120_000 : 60_000,
  });

  test('Panel opens with checkboxes defaulted and layer defaulting to Navigation', async ({ page }) => {
    await boot(page);
    // Need a route so exportPNG doesn't NOP; the panel should show regardless.
    await page.evaluate(wps => {
      state.waypoints = wps;
      syncLegs(); draw();
    }, pairLLHZ_LLHA());
    await openPanel(page);
    // 6 checkboxes: Waypoint Names (on), Drift Lines (on), Cumulative time (on),
    // Nav WPs (off), Airfields (off), Place flight plan (off, disabled w/o frame).
    const cbs = page.locator('#export-panel input[type="checkbox"]');
    expect(await cbs.count()).toBe(6);
    expect(await cbs.nth(0).isChecked()).toBe(true);   // Waypoint Names default on
    expect(await cbs.nth(1).isChecked()).toBe(true);   // Drift Lines default on
    expect(await cbs.nth(2).isChecked()).toBe(true);   // Cumulative time default on
    expect(await cbs.nth(3).isChecked()).toBe(false);  // Nav WPs
    expect(await cbs.nth(4).isChecked()).toBe(false);  // Airfields
    expect(await cbs.nth(5).isChecked()).toBe(false);  // Place flight plan
    expect(await cbs.nth(5).isDisabled()).toBe(true);  // disabled until a page frame is set
    // Layer defaults to Navigation.
    const sel = page.locator('#export-layer-select');
    expect(await sel.inputValue()).toBe('Navigation');
    // Two action buttons: Export + Print.
    expect(await page.locator('#export-panel .export-panel-btns button').count()).toBe(2);
    // Closing the section tears the panel down.
    await closePanel(page);
    await expect(page.locator('#export-panel .export-panel-btns button')).toHaveCount(0);
  });

  test('Export with defaults uses Navigation layer', async ({ page }) => {
    await boot(page);
    await page.locator('#layer-select').selectOption('OpenStreetMap');
    await page.evaluate(wps => {
      state.waypoints = wps;
      syncLegs(); draw();
    }, pairLLHZ_LLHA());
    // Open panel, leave defaults, click Export.
    const dl = page.waitForEvent('download', { timeout: 30000 });
    await openPanel(page);
    await page.locator('#export-panel .export-panel-btns button').first().click();
    const download = await dl;
    expect(download.suggestedFilename()).toMatch(/^navigation-.+\.png$/);
  });

  test('Live preview: panel defaults hide waypoints/airfields immediately', async ({ page }) => {
    await boot(page);
    // Turn waypoints and airfields on so we can verify the panel hides them.
    await page.evaluate(() => { showNavWP = true; showAirfields = true; draw(); });
    await openPanel(page);
    // Default state applied: both should be false now.
    expect(await page.evaluate(() => showNavWP)).toBe(false);
    expect(await page.evaluate(() => showAirfields)).toBe(false);
  });

  test('Live preview: toggling checkbox updates the map immediately', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { showNavWP = false; showAirfields = false; draw(); });
    await openPanel(page);
    const cbs = page.locator('#export-panel input[type="checkbox"]');
    // Check "Print navigation waypoints" (idx 3) → showNavWP becomes true.
    await cbs.nth(3).check();
    expect(await page.evaluate(() => showNavWP)).toBe(true);
    // Uncheck → showNavWP back to false.
    await cbs.nth(3).uncheck();
    expect(await page.evaluate(() => showNavWP)).toBe(false);
    // Check "Print airfields" (idx 4) → showAirfields becomes true.
    await cbs.nth(4).check();
    expect(await page.evaluate(() => showAirfields)).toBe(true);
  });

  test('Closing the section restores original waypoints/airfields state', async ({ page }) => {
    await boot(page);
    // Starting with both visible.
    await page.evaluate(() => { showNavWP = true; showAirfields = true; draw(); });
    await openPanel(page);
    // Panel hides them (default). Toggle waypoints on (idx 3 = Nav WPs).
    await page.locator('#export-panel input[type="checkbox"]').nth(3).check();
    expect(await page.evaluate(() => showNavWP)).toBe(true);
    // Close the section → restore original (both true).
    await closePanel(page);
    await expect(page.locator('#export-panel .export-panel-btns button')).toHaveCount(0);
    expect(await page.evaluate(() => showNavWP)).toBe(true);
    expect(await page.evaluate(() => showAirfields)).toBe(true);
  });

  test('Closing the section restores original layer', async ({ page }) => {
    await boot(page);
    await page.locator('#layer-select').selectOption('OpenStreetMap');
    await page.evaluate(wps => {
      state.waypoints = wps;
      syncLegs(); draw();
    }, pairLLHZ_LLHA());
    // Verify we're on OSM.
    expect(await page.locator('#layer-select').inputValue()).toBe('OpenStreetMap');
    // Open panel (defaults to Navigation), then close the section.
    await openPanel(page);
    await closePanel(page);
    // Back to OSM.
    expect(await page.locator('#layer-select').inputValue()).toBe('OpenStreetMap');
  });

  test('Reopening the panel rebuilds it with defaults restored', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { showNavWP = true; draw(); });
    await openPanel(page);
    // Toggle Nav WPs off in the panel (idx 3).
    await page.locator('#export-panel input[type="checkbox"]').nth(3).uncheck();
    expect(await page.evaluate(() => showNavWP)).toBe(false);
    // Close → original state restored.
    await closePanel(page);
    expect(await page.evaluate(() => showNavWP)).toBe(true);
    // Reopen → freshly built panel re-applies its defaults (Nav WPs off again).
    await openPanel(page);
    expect(await page.locator('#export-panel input[type="checkbox"]').nth(3).isChecked()).toBe(false);
    expect(await page.evaluate(() => showNavWP)).toBe(false);
  });

  test('the export panel offers a Print action that opens a 1:1 print window', async ({ page }) => {
    await boot(page);
    await page.evaluate(wps => {
      window.pageOrient = 'landscape';
      if (typeof setPage === 'function' && pageSize !== 'A4') setPage('A4');
      state.waypoints = wps; syncLegs(); draw();
    }, pairLLHZ_LLHA());
    // Capture what openPrintWindow would write to the popup.
    const html = await page.evaluate(() => new Promise(resolve => {
      let out = '';
      const doc = { open() {}, close() {}, write(s) { out += s; }, querySelector: () => ({}) };
      window.open = () => ({ document: doc, focus() {}, print() {} });
      // A4 landscape paper.
      openPrintWindow(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 297, 210);
      setTimeout(() => resolve(out), 30);
    }));
    expect(html).toMatch(/@page\{size:297mm 210mm;margin:0\}/);
    expect(html).toMatch(/img\{width:297mm;height:210mm/);

    // The inline panel exposes a Print button next to Export.
    await openPanel(page);
    const labels = await page.locator('#export-panel .export-panel-btns button').allTextContents();
    expect(labels.some(t => /print/i.test(t))).toBe(true);
  });

  test('Warns when no page size (A3/A4) is selected', async ({ page }) => {
    await boot(page);
    await page.evaluate(wps => {
      state.waypoints = wps;
      syncLegs(); draw();
      pageSize = null;
    }, pairLLHZ_LLHA());
    await openPanel(page);
    await expect(page.locator('#export-panel').getByText(/no page size/i)).toBeVisible();
    await closePanel(page);

    // Select A3 and reopen — warning should be gone.
    await page.evaluate(() => setPage('A3'));
    await openPanel(page);
    await expect(page.locator('#export-panel').getByText(/no page size/i)).not.toBeVisible();
    await closePanel(page);
  });

  test.describe('PNG DPI metadata (pHYs chunk)', () => {
    // Tile fetch + canvas export can exceed the default 15s test timeout locally.
    test.describe.configure({ timeout: 60_000 });
    async function exportPng(page) {
      const dl = page.waitForEvent('download', { timeout: 30000 });
      await openPanel(page);
      await page.locator('#export-panel .export-panel-btns button').first().click();
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
      await page.evaluate(wps => {
        state.waypoints = wps;
        syncLegs(); draw();
        pageSize = null;
      }, pairLLHZ_LLHA());
      const buf = await exportPng(page);
      expect(readPng(buf)).toBeNull();
    });

    test('A4 portrait → pHYs embedded (~11811 ppm ≈ 300 DPI)', async ({ page }) => {
      await boot(page);
      await page.evaluate(wps => {
        state.waypoints = wps;
        syncLegs(); draw();
        pageSize = 'A4'; pageOrient = 'portrait';
      }, pairLLHZ_LLHA());
      const buf = await exportPng(page);
      const ppm = readPng(buf);
      expect(ppm).not.toBeNull();
      expect(ppm).toBeGreaterThan(4000);
    });

    test('A3 portrait → pHYs embedded', async ({ page }) => {
      await boot(page);
      await page.evaluate(wps => {
        state.waypoints = wps;
        syncLegs(); draw();
        pageSize = 'A3'; pageOrient = 'portrait';
      }, pairLLHZ_LLHA());
      const buf = await exportPng(page);
      const ppm = readPng(buf);
      expect(ppm).not.toBeNull();
      expect(ppm).toBeGreaterThan(4000);
    });
  });

  test('map-opacity slider has a reset-to-default (80%) button', async ({ page }) => {
    await boot(page);
    await openPanel(page);
    const slider = page.locator('#export-panel input[type="range"]').first();
    const reset = page.locator('#export-panel .slider-reset').first();
    await expect(reset).toHaveCount(1);
    // Move it off the default, then reset.
    await slider.fill('40');
    expect(await page.evaluate(() => Math.round(mapOpacity * 100))).toBe(40);
    await reset.click();
    await expect(slider).toHaveValue('80');
    expect(await page.evaluate(() => Math.round(mapOpacity * 100))).toBe(80);
  });

  test('Panel respects checkbox toggles and layer change', async ({ page }) => {
    await boot(page);
    await page.evaluate(wps => {
      state.waypoints = wps;
      syncLegs(); draw();
    }, pairLLHZ_LLHA());
    await openPanel(page);
    // Toggle both checkboxes on, switch to CVFR.
    const cbs = page.locator('#export-panel input[type="checkbox"]');
    await cbs.nth(1).check();
    await cbs.nth(0).check();
    await page.locator('#export-layer-select').selectOption('CVFR');
    expect(await cbs.nth(1).isChecked()).toBe(true);
    expect(await cbs.nth(0).isChecked()).toBe(true);
    expect(await page.locator('#export-layer-select').inputValue()).toBe('CVFR');
    // Click Export and verify download triggers.
    const dl = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('#export-panel .export-panel-btns button').first().click();
    const download = await dl;
    expect(download.suggestedFilename()).toMatch(/^navigation-.+\.png$/);
  });
});
