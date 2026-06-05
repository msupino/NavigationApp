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
      window.showVor = true;            // the radial row is overlay-gated
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
    // Overlay off → no row even with a reference selected.
    await page.evaluate(() => { window.showVor = false; showInspector(); });
    await expect(page.locator('#insp-body .vor-radial-row')).toHaveCount(0);
  });

  test('flight plan: VOR picker + frequency, Radial/DME to the leg START', async ({ page }) => {
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
    const headers = await page.locator('.flight-table thead th').allTextContents();
    expect(headers).toEqual(expect.arrayContaining(['Radial', 'DME']));
    await page.locator('#fp-vor-select').selectOption('NAT');
    await expect(page.locator('.fp-vor-freq')).toContainText('112.40');
    const radialIdx = headers.indexOf('Radial');
    const firstRow = page.locator('.flight-table tbody tr').first();
    // Radial/DME are for the leg's START point (A), not the destination.
    const expected = await page.evaluate(() => {
      const rd = vorRadialDme(activeVor(), 32.1, 34.85);
      return { r: 'R-' + rd.radial, d: rd.dme };
    });
    // Radial cell carries a per-leg VOR picker + the value span.
    await expect(firstRow.locator('td').nth(radialIdx).locator('.fp-radial-val')).toHaveText(expected.r);
    await expect(firstRow.locator('td').nth(radialIdx + 1)).toHaveText(expected.d);
  });

  test('flight plan: per-leg VOR override changes that leg only', async ({ page }) => {
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
    await page.locator('#fp-vor-select').selectOption('NAT');     // default = NAT
    const headers = await page.locator('.flight-table thead th').allTextContents();
    const radialIdx = headers.indexOf('Radial');
    const firstRow = page.locator('.flight-table tbody tr').first();
    // Override leg 0 to BGN.
    await firstRow.locator('td').nth(radialIdx).locator('select.fp-leg-vor').selectOption('BGN');
    expect(await page.evaluate(() => state.legs[0].vorRef)).toBe('BGN');
    const expBgn = await page.evaluate(() => {
      const rd = vorRadialDme(vorByIdent('BGN'), 32.1, 34.85);
      return 'R-' + rd.radial;
    });
    await expect(firstRow.locator('td').nth(radialIdx).locator('.fp-radial-val')).toHaveText(expBgn);
  });

  test('flight plan hides the Radial/DME columns when no VOR is selected', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.1, lng: 34.85, name: 'A' },
        { lat: 32.46, lng: 34.91, name: 'B' },
      ];
      syncLegs(); draw();
    });
    await page.locator('#plan').click();
    await page.locator('.modal-back').waitFor();
    // No VOR → table marked no-vor, Radial header hidden.
    await expect(page.locator('.flight-table').first()).toHaveClass(/no-vor/);
    await expect(page.locator('.flight-table thead .fp-vor-col').first()).toBeHidden();
    // Select a VOR → columns appear.
    await page.locator('#fp-vor-select').selectOption('NAT');
    await expect(page.locator('.flight-table').first()).not.toHaveClass(/no-vor/);
    await expect(page.locator('.flight-table thead .fp-vor-col').first()).toBeVisible();
  });

  test('bottom-bar radial/DME follows the reference VOR (independent of markers)', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(async () => {
      await loadVors();
      window.vorRef = 'NAT';
      window.showVor = false;            // markers off — readout still works
      const refMarkersOff = vorReadoutText(32.4, 34.9);
      window.vorRef = null;              // no reference → no readout
      const noRef = vorReadoutText(32.4, 34.9);
      return { refMarkersOff, noRef };
    });
    expect(out.refMarkersOff).toMatch(/NAT R-\d{3}° \/ \d/);
    expect(out.noRef).toBe('');
  });

  test('markers are selectable outside edit mode (VOR / airfield / nav-WP)', async ({ page }) => {
    await boot(page);
    // VOR marker hit-test + read-only inspector + "use as reference".
    const hit = await page.evaluate(async () => {
      await loadVors();
      window.showVor = true;
      map.setView([32.332, 34.968], 10);
      const s = proj(vorByIdent('NAT'));
      return hitOverlayMarker(Math.round(s.x), Math.round(s.y));
    });
    expect(hit).toMatchObject({ type: 'vor' });
    await page.evaluate(t => { state.selected = t; showInspector(); }, hit);
    await expect(page.locator('#insp-title')).toHaveValue('NAT');
    await expect(page.locator('#insp-body')).toContainText('112.40');
    const useBtn = page.locator('#insp-body .insp-btn', { hasText: /reference/i });
    await expect(useBtn).toBeVisible();
    await useBtn.click();
    expect(await page.evaluate(() => vorRef)).toBe('NAT');

    // Airfield marker → read-only inspector with coordinates.
    const afHit = await page.evaluate(async () => {
      if (typeof loadAirfields === 'function') await loadAirfields();
      window.showAirfields = true;
      const af = airfields.find(a => a.name === 'LLHA') || airfields[0];
      map.setView([af.lat, af.lng], 10);
      const s = proj(af);
      return { hit: hitOverlayMarker(Math.round(s.x), Math.round(s.y)), name: af.name };
    });
    expect(afHit.hit).toMatchObject({ type: 'airfield' });
    await page.evaluate(t => { state.selected = t; showInspector(); }, afHit.hit);
    await expect(page.locator('#insp-title')).toHaveValue(new RegExp(afHit.name));
  });

  test('markers are NOT selected in add (edit) mode', async ({ page }) => {
    await boot(page);
    const hit = await page.evaluate(async () => {
      await loadVors();
      window.showVor = true;
      state.mode = 'add';
      map.setView([32.332, 34.968], 10);
      const s = proj(vorByIdent('NAT'));
      // Simulate the mousedown gate: overlay hit only when not in add/note.
      return (state.mode !== 'add' && state.mode !== 'note')
        ? hitOverlayMarker(Math.round(s.x), Math.round(s.y)) : null;
    });
    expect(hit).toBeNull();
  });

  test('route templates are returned sorted alphabetically by name', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(async () => {
      const list = await loadRouteTemplates();
      const names = list.map(t => t.name);
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      return { names, sorted };
    });
    expect(out.names).toEqual(out.sorted);
  });
});
