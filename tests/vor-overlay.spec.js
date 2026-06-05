// @ts-check
// VOR/DME overlay + radial/DME readouts (issue #404 follow-up): map markers,
// a selectable reference VOR, and magnetic radial + DME of any point shown in
// the cursor readout and the waypoint inspector.
const { test, expect } = require('./_setup');

async function boot(page, lang = 'en') {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_vor_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_vor_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=' + lang);
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof loadVors === 'function');
}

test.describe('VOR overlay + radial/DME (#404)', () => {
  test('dataset loads and exposes the named stations', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(async () => {
      await loadVors();
      const idents = vors.map(v => v.ident);
      return { count: vors.length, idents, nat: vorByIdent('NAT') };
    });
    expect(out.count).toBeGreaterThanOrEqual(5);
    expect(out.idents).toEqual(expect.arrayContaining(['BGN', 'NAT', 'ROP', 'MZD']));
    expect(out.nat).toMatchObject({ ident: 'NAT', freq: '112.40' });
  });

  test('vorRadialDme gives a magnetic radial and great-circle DME', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(async () => {
      await loadVors();
      const v = vorByIdent('NAT');
      // A point ~due magnetic-north-ish of NAT, a few NM away.
      return vorRadialDme(v, 32.46472, 34.91222);
    });
    expect(out.radial).toMatch(/^\d{3}$/);
    expect(parseFloat(out.dme)).toBeGreaterThan(0);
    expect(parseFloat(out.dme)).toBeLessThan(20);
  });

  test('toggle + reference selection persist across reload', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#vor-cb')).not.toBeChecked();
    await expect(page.locator('#vor-ref-row')).toBeHidden();
    await page.locator('#vor-cb').click();
    await expect(page.locator('#vor-ref-row')).toBeVisible();
    await page.locator('#vor-ref-select').selectOption('NAT');
    expect(await page.evaluate(() => vorRef)).toBe('NAT');
    expect(await page.evaluate(() => localStorage.getItem('navaid.showVor'))).toBe('1');
    expect(await page.evaluate(() => localStorage.getItem('navaid.vorRef'))).toBe('NAT');

    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && window.vors);
    await expect(page.locator('#vor-cb')).toBeChecked();
    expect(await page.evaluate(() => vorRef)).toBe('NAT');
  });

  test('inspector shows From <VOR> radial/DME when a reference is selected', async ({ page }) => {
    await boot(page);
    await page.evaluate(async () => {
      await loadVors();
      window.vorRef = 'NAT';
      state.waypoints = [
        { lat: 32.46472, lng: 34.91222, name: 'HADRA' },
        { lat: 32.0, lng: 34.8, name: 'X' },
      ];
      syncLegs();
      state.selected = { type: 'wp', index: 0 }; showInspector();
    });
    const row = page.locator('#insp-body .vor-radial-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/NAT/);
    await expect(row).toContainText(/R-\d{3}° \/ \d/);
    // No reference → no row.
    await page.evaluate(() => { window.vorRef = null; showInspector(); });
    await expect(page.locator('#insp-body .vor-radial-row')).toHaveCount(0);
  });

  test('flight plan shows Radial/DME columns + VOR picker with frequency', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.1, lng: 34.85, name: 'A' },
        { lat: 32.46472, lng: 34.91222, name: 'HADRA' },
      ];
      syncLegs(); draw();
    });
    await page.locator('#plan').click();
    await page.locator('.modal-back').waitFor();
    // Header carries Radial + DME.
    const headers = await page.locator('.flight-table thead th').allTextContents();
    expect(headers).toEqual(expect.arrayContaining(['Radial', 'DME']));
    // Pick NAT → freq shows, leg radial/DME populate (To = HADRA).
    await page.locator('#fp-vor-select').selectOption('NAT');
    await expect(page.locator('.fp-vor-freq')).toContainText('112.40');
    const radialIdx = headers.indexOf('Radial');
    const firstRow = page.locator('.flight-table tbody tr').first();
    await expect(firstRow.locator('td').nth(radialIdx)).toHaveText(/^R-\d{3}$/);
    await expect(firstRow.locator('td').nth(radialIdx + 1)).toHaveText(/^\d+(\.\d)?$/);
  });
});
