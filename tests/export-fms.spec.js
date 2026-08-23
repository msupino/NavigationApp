const { test, expect } = require('./_setup');

async function boot(page, lang = 'en') {
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => typeof exportFms === 'function' &&
    typeof syncLegs === 'function' && typeof loadAirfields === 'function');
  await page.evaluate(async () => {
    await loadAirfields();
    URL.createObjectURL = blob => {
      window.__fmsBlob = blob;
      return 'blob:fms-test';
    };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () {
      window.__fmsFilename = this.download;
    };
  });
}

test('exports the complete route in X-Plane 1100 FMS format', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    state.waypoints = [
      { lat: 32.17944, lng: 34.83444, name: 'LLHZ' },
      { lat: 32.21861, lng: 34.8825, name: 'BAZRA' },
      { lat: 32.21861, lng: 34.8825, name: 'BAZRA' },
      { lat: 32.98056, lng: 35.57083, name: 'renamed destination' },
    ];
    state.legs = [];
    syncLegs();
    state.legs[0].inboundAltitude = null;
    state.legs[1].inboundAltitude = 4500;
    state.legs[2].inboundAltitude = 3500;
    const before = JSON.stringify(state.waypoints);
    document.getElementById('export-select').value = 'fms';
    document.getElementById('export-select').dispatchEvent(new Event('change'));
    return {
      text: await window.__fmsBlob.text(),
      type: window.__fmsBlob.type,
      filename: window.__fmsFilename,
      unchanged: before === JSON.stringify(state.waypoints),
    };
  });

  const lines = result.text.trim().split('\n');
  expect(lines.slice(0, 2)).toEqual(['I', '1100 Version']);
  expect(lines[2]).toMatch(/^CYCLE \d{4}$/);
  expect(lines.slice(3, 6)).toEqual(['ADEP LLHZ', 'ADES LLIB', 'NUMENR 4']);
  expect(lines[6]).toBe('1 LLHZ ADEP 4500.000000 32.179440 34.834440');
  expect(lines[7]).toBe('28 BAZRA DRCT 4500.000000 32.218610 34.882500');
  expect(lines[8]).toBe('28 BAZRA DRCT 3500.000000 32.218610 34.882500');
  expect(lines[9]).toBe('1 LLIB ADES 3500.000000 32.980560 35.570830');
  expect(result.type).toContain('text/plain');
  expect(result.filename).toMatch(/\.fms$/);
  expect(result.unchanged).toBe(true);
});

test('uses direct coordinate endpoints and computes the AIRAC cycle', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    state.waypoints = [
      { lat: 31.8, lng: 34.6, name: 'start point' },
      { lat: 31.9, lng: 34.7, name: 'נקודה' },
    ];
    state.legs = [];
    syncLegs();
    state.legs[0].inboundAltitude = 2500;
    exportFms();
    return {
      text: await window.__fmsBlob.text(),
      cycle: xplaneAiracCycle(new Date(Date.UTC(2026, 7, 23))),
    };
  });
  expect(result.cycle).toBe('2608');
  expect(result.text).toContain('DEP STARTPOINT\n');
  expect(result.text).toContain('DES WP2\n');
  expect(result.text).toContain('28 STARTPOINT DRCT 2500.000000 31.800000 34.600000');
  expect(result.text).toContain('28 WP2 DRCT 2500.000000 31.900000 34.700000');
});

test('shows distinct FMS and FDR purposes in English and Hebrew', async ({ page }) => {
  await boot(page, 'en');
  const english = await page.locator('#export-select option[value="fms"]').textContent();
  expect(english).toContain('FMS');
  expect(english).toContain('flight plan');

  await page.goto('?lang=he&nogist');
  const hebrew = await page.locator('#export-select option[value="fms"]').textContent();
  expect(hebrew).toContain('FMS');
  expect(hebrew).toContain('תוכנית טיסה');
  await expect(page.locator('#export-select option[value="fdr"]')).toContainText('FDR');
});
