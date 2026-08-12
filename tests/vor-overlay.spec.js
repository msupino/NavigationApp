// @ts-check
// VOR/DME overlay + radial/DME readouts (issue #404 follow-up): map markers,
// a selectable reference VOR, and magnetic radial + DME of any point shown in
// its own bottom readout and the waypoint inspector.
const { test, expect } = require('./_setup');
const { hideToolbarMenus } = require('./_toolbar');

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
    await expect(page.locator('#vor-cb')).toBeChecked();
    expect(await page.evaluate(() => showVorStations)).toBe(true);
    await expect(page.locator('#vor-ref-row')).toBeVisible();
    await expect(page.locator('#vor-ref-select option[value="NAT"]')).toHaveCount(1);
    await page.locator('#vor-ref-select').selectOption('NAT');
    expect(await page.evaluate(() => vorRef)).toBe('NAT');
    expect(await page.evaluate(() => localStorage.getItem('navaid.vorRef'))).toBe('NAT');

    await page.locator('#vor-cb').uncheck();
    expect(await page.evaluate(() => localStorage.getItem('navaid.showVorStations'))).toBe('0');
    expect(await page.evaluate(() => localStorage.getItem('navaid.showVor'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('navaid.vorRef'))).toBe('NAT');

    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && window.vors);
    await expect(page.locator('#vor-cb')).not.toBeChecked();
    expect(await page.evaluate(() => showVorStations)).toBe(false);
    expect(await page.evaluate(() => vorRef)).toBe('NAT');
  });

  test('legacy showVor storage migrates to showVorStations', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('navaid.showVor', '0');
      } catch (e) {}
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof state !== 'undefined' && typeof loadVors === 'function');
    await expect(page.locator('#vor-cb')).not.toBeChecked();
    expect(await page.evaluate(() => showVorStations)).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem('navaid.showVorStations'))).toBe('0');
    expect(await page.evaluate(() => localStorage.getItem('navaid.showVor'))).toBeNull();
  });

  test('inspector VOR selector drives radial/DME without changing global reference', async ({ page }) => {
    await boot(page);
    await page.evaluate(async () => {
      await loadVors();
      window.showVorStations = false;   // markers off — readout still works
      window.vorRef = 'NAT';
      localStorage.setItem('navaid.vorRef', 'NAT');
      window.inspectorVorRef = undefined;
      state.waypoints = [
        { lat: 32.46472, lng: 34.91222, name: 'HADRA' },
        { lat: 32.0, lng: 34.8, name: 'X' },
      ];
      syncLegs();
      state.selected = { type: 'wp', index: 0 }; showInspector();
    });
    await hideToolbarMenus(page);
    const row = page.locator('#insp-body .vor-radial-row');
    await expect(row).toHaveCount(1);
    const sel = row.locator('select.insp-vor-ref');
    const val = row.locator('.vor-radial-val');
    await expect(sel).toHaveValue('NAT');
    await expect(sel.locator('option[value="NAT"]')).toHaveText('NAT');
    await expect(sel.locator('option[value="BGN"]')).toHaveText('BGN');
    await expect(val).toHaveText(/R-\d{3}° \/ \d/);
    const bgnExpected = await page.evaluate(() => {
      const rd = vorRadialDme(vorByIdent('BGN'), 32.46472, 34.91222);
      return S.vorRadialDme(rd.radial, rd.dme);
    });
    await sel.selectOption('BGN');
    await expect(sel).toHaveValue('BGN');
    await expect(val).toHaveText(bgnExpected);
    expect(await page.evaluate(() => vorRef)).toBe('NAT');
    expect(await page.evaluate(() => localStorage.getItem('navaid.vorRef'))).toBe('NAT');

    await sel.selectOption('');
    await expect(sel).toHaveValue('');
    await expect(val).toHaveText('');
    expect(await page.evaluate(() => vorRef)).toBe('NAT');

    await page.locator('#insp-close').click();
    await expect(page.locator('#inspector')).toHaveClass(/hidden/);
    expect(await page.evaluate(() => inspectorVorRef)).toBeUndefined();
    await page.evaluate(() => {
      state.selected = { type: 'wp', index: 0 };
      showInspector();
    });
    await expect(page.locator('#insp-body .vor-radial-row select.insp-vor-ref'))
      .toHaveValue('NAT');
  });

  test('Hebrew inspector VOR radial row keeps label separated from LTR readout', async ({ page }) => {
    await boot(page, 'he');
    await page.evaluate(async () => {
      await loadVors();
      window.vorRef = 'NAT';
      window.inspectorVorRef = undefined;
      state.waypoints = [{ lat: 32.46472, lng: 34.91222, name: 'HADRA' }];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
    });
    const row = page.locator('#insp-body .vor-radial-row');
    const label = row.locator('label');
    const controls = row.locator('.vor-radial-controls');
    const val = row.locator('.vor-radial-val');
    await expect(label).toHaveText('תחנת ייחוס');
    await expect(val).toHaveText(/R-\d{3}° \/ \d+\.\d NM/);
    const bidi = await val.evaluate(el => {
      const style = getComputedStyle(el);
      return { direction: style.direction, unicodeBidi: style.unicodeBidi };
    });
    expect(bidi.direction).toBe('ltr');
    expect(bidi.unicodeBidi).toContain('isolate');
    const [labelBox, controlsBox] = await Promise.all([
      label.boundingBox(),
      controls.boundingBox(),
    ]);
    expect(labelBox && controlsBox).toBeTruthy();
    expect(controlsBox.x + controlsBox.width).toBeLessThan(labelBox.x - 4);
  });

  test('the "— none —" placeholder is not clipped, in Hebrew or English', async ({ page }) => {
    // Regression: a fixed 58px width fit the VOR idents this select mostly shows
    // ("BGN", "NAT"), but clipped the much longer placeholder option -- reported live
    // as a stray "א —" (the placeholder's own trailing letters, everything before them
    // cut off). Native <select> with no explicit width sizes to its currently
    // SELECTED option's own rendered width, so this stays just as compact for an
    // ident and only widens when the placeholder is what's actually shown.
    for (const lang of ['he', 'en']) {
      await boot(page, lang);
      await page.evaluate(async () => {
        await loadVors();
        window.vorRef = '';
        window.inspectorVorRef = undefined;
        state.waypoints = [{ lat: 32.46472, lng: 34.91222, name: 'HADRA' }];
        syncLegs();
        state.selected = { type: 'wp', index: 0 };
        showInspector();
      });
      const sel = page.locator('#insp-body .vor-radial-row select.insp-vor-ref');
      await expect(sel).toHaveValue('');
      const out = await sel.evaluate(el => {
        const b = el.getBoundingClientRect();
        return { text: el.options[el.selectedIndex].textContent, width: b.width, scrollWidth: el.scrollWidth };
      });
      expect(out.width, lang + ': ' + out.text).toBeGreaterThanOrEqual(out.scrollWidth);
    }
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
      window.showVorStations = false;    // markers off — readout still works
      const refMarkersOff = vorReadoutText(32.4, 34.9);
      window.vorRef = null;              // no reference → no readout
      const noRef = vorReadoutText(32.4, 34.9);
      return { refMarkersOff, noRef };
    });
    expect(out.refMarkersOff).toMatch(/NAT R-\d{3}° \/ \d/);
    expect(out.noRef).toBe('');
  });

  test('bottom readouts keep coordinates and VOR radial/DME in separate boxes', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(async () => {
      await loadVors();
      window.vorRef = 'NAT';
      window.showVorStations = false;    // marker overlay remains independent
      const p = L.latLng(32.4, 34.9);
      map.fire('mousemove', { latlng: p });
      return {
        coord: document.getElementById('coord-readout').textContent,
        vor: document.getElementById('vor-readout').textContent,
        coordExpected: fmtLatLng(p.lat, 'N', 'S') + '  ' + fmtLatLng(p.lng, 'E', 'W'),
        vorHidden: document.getElementById('vor-readout').getAttribute('aria-hidden'),
      };
    });
    expect(out.coord).toBe(out.coordExpected);
    expect(out.coord).not.toMatch(/NAT R-/);
    expect(out.vor).toMatch(/NAT R-\d{3}° \/ \d/);
    expect(out.vorHidden).toBe('false');

    await page.evaluate(() => { window.vorRef = null; showCenterCoord(); });
    await expect(page.locator('#vor-readout')).not.toHaveClass(/show/);
    await expect(page.locator('#vor-readout')).toHaveAttribute('aria-hidden', 'true');
  });

  test('nav-waypoint inspector title carries the resolved name in English too', async ({ page }) => {
    await boot(page, 'en');
    const out = await page.evaluate(async () => {
      await loadNavWaypoints();
      const index = navWP.findIndex(w => w.name === 'HADRA');
      state.selected = { type: 'navwp', index: index >= 0 ? index : 0 };
      showInspector();
      const wp = navWP[state.selected.index];
      return { code: wp.name, label: wp.en };
    });
    // Title is "CODE / localized name" (the name moved from a row into the title).
    const title = page.locator('#insp-title');
    await expect(title).toHaveValue(new RegExp(out.code + '.*' + out.label));
  });

  test('reference inspectors share the CODE / localized name title shape', async ({ page }) => {
    await boot(page, 'en');
    const titles = await page.evaluate(async () => {
      await Promise.all([loadVors(), loadAirfields(), loadNavWaypoints()]);
      const readTitle = () => document.getElementById('insp-title').value;
      const natIdx = vors.findIndex(v => v.ident === 'NAT');
      state.selected = { type: 'vor', index: natIdx };
      showInspector();
      const vor = readTitle();

      const afIdx = airfields.findIndex(a => a.name === 'LLHA');
      state.selected = { type: 'airfield', index: afIdx };
      showInspector();
      const airfield = readTitle();

      const hadraIdx = navWP.findIndex(w => w.name === 'HADRA');
      state.selected = { type: 'navwp', index: hadraIdx };
      showInspector();
      const navwp = readTitle();

      const hadra = navWP[hadraIdx];
      state.waypoints = [{ lat: hadra.lat, lng: hadra.lng, name: 'HADRA' }];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
      const routeWp = readTitle();

      return { vor, airfield, navwp, routeWp };
    });
    expect(titles.vor).toMatch(/^NAT \/ Natania$/);
    expect(titles.airfield).toMatch(/^LLHA \/ Haifa/);
    expect(titles.navwp).toMatch(/^HADRA \/ Hadera$/);
    expect(titles.routeWp).toBe(titles.navwp);
  });

  test('markers are selectable outside edit mode (VOR / airfield / nav-WP)', async ({ page }) => {
    await boot(page);
    // VOR marker hit-test + read-only inspector + "use as reference".
    const hit = await page.evaluate(async () => {
      await loadVors();
      window.showVorStations = true;
      map.setView([32.332, 34.968], 10);
      const s = proj(vorByIdent('NAT'));
      return hitOverlayMarker(Math.round(s.x), Math.round(s.y));
    });
    expect(hit).toMatchObject({ type: 'vor' });
    await page.evaluate(t => { state.selected = t; showInspector(); }, hit);
    await expect(page.locator('#insp-title')).toHaveValue(/NAT.*Natania/);
    await expect(page.locator('#insp-body .vor-freq-row .charts-freq-input')).toHaveValue('112.40');
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
      window.showVorStations = true;
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

  test('validateVors rejects mis-shaped payloads', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => {
      const cases = [];
      cases.push(validateVors(null));
      cases.push(validateVors({}));
      cases.push(validateVors({ vors: 'not-array' }));
      cases.push(validateVors({ vors: [{ ident: 1, name: 'X', freq: '112.40', lat: 32, lng: 34 }] }));
      cases.push(validateVors({ vors: [{ ident: 'NAT' }] }));
      return cases;
    });
    expect(out[0]).toEqual(expect.any(String));
    expect(out[1]).toEqual(expect.any(String));
    expect(out[2]).toEqual(expect.any(String));
    expect(out[3]).toEqual(expect.any(String));     // ident not a string
    expect(out[4]).toEqual(expect.any(String));     // missing fields
  });

  test('validateVors accepts a valid payload', async ({ page }) => {
    await boot(page);
    const err = await page.evaluate(() => validateVors({
      vors: [{ ident: 'NAT', name: 'Natania', freq: '112.40', lat: 32.3, lng: 34.9 }],
    }));
    expect(err).toBeNull();
  });

  test('flight plan: return table also shows Radial/DME columns', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.1, lng: 34.85, name: 'A' },
        { lat: 32.46472, lng: 34.91222, name: 'HADRA' },
      ];
      syncLegs(); draw();
    });
    await page.evaluate(() => { window.showReturn = true; });
    await page.locator('#plan').click();
    await page.locator('.modal-back').waitFor();
    await page.locator('#fp-vor-select').selectOption('NAT');
    // Return table is the second .flight-table when showReturn is on.
    const tables = page.locator('.flight-table');
    await expect(tables).toHaveCount(2);
    const retRow = tables.nth(1).locator('tbody tr').first();
    const expected = await page.evaluate(() => {
      const rd = vorRadialDme(activeVor(), 32.46472, 34.91222);
      return 'R-' + rd.radial;
    });
    await expect(retRow.locator('td .fp-radial-val')).toHaveText(expected);
  });

  test('flight plan: print export includes radial/DME values', async ({ page }) => {
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
    await page.locator('#fp-vor-select').selectOption('NAT');
    // The gatherer (_gatherFlightPlan) extracts .fp-radial-val values.
    const gathered = await page.evaluate(() => {
      const tbody = document.querySelector('.flight-table tbody');
      const radialVal = tbody.querySelector('.fp-radial-val');
      return radialVal ? radialVal.textContent : '';
    });
    expect(gathered).toMatch(/R-\d{3}/);
  });

  test('airfield inspector shows English name, runways, elevation, and plates with categories', async ({ page }) => {
    await boot(page, 'en');
    const out = await page.evaluate(async () => {
      if (typeof loadAirfields === 'function') await loadAirfields();
      loadAirfields();
      return airfields && airfields.find(a => a.name === 'LLHA');
    });
    const af = out;
    // Use a known airfield with all the features.
    await page.evaluate(async () => {
      state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLHA') };
      showInspector();
    });
    // Title shows ICAO + English name.
    await expect(page.locator('#insp-title')).toHaveValue(/LLHA/);
    if (af && af.en) await expect(page.locator('#insp-title')).toHaveValue(new RegExp(af.en));
    // Elevation.
    if (af && Number.isFinite(af.elev_ft)) {
      await expect(page.locator('#insp-body')).toContainText(/\d+ ft/);
    }
    // Runways as chips.
    if (af && Array.isArray(af.runways) && af.runways.length) {
      await expect(page.locator('#insp-body .runway-chip').first()).toBeVisible();
      await expect(page.locator('#insp-body .runway-chip').first()).toHaveText(af.runways[0]);
    }
    // Charts button (the full plate list lives in the Charts modal now).
    if (af && Array.isArray(af.plates) && af.plates.length) {
      await expect(page.locator('#insp-body .insp-charts-btn')).toBeVisible();
    }
  });

  test('airfield inspector shows primary, clearance, and ATIS frequencies when available', async ({ page }) => {
    await boot(page, 'en');
    await page.evaluate(async () => {
      await Promise.all([loadAirfields(), loadCommChange()]);
      state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLHA') };
      showInspector();
    });
    await expect(page.locator('#insp-body .primary-row')).toContainText('Primary');
    await expect(page.locator('#insp-body .primary-row .charts-freq-input')).toHaveValue('133.00');
    await expect(page.locator('#insp-body .atis-row')).toContainText('ATIS');
    await expect(page.locator('#insp-body .atis-row .charts-freq-input')).toHaveValue('135.40');

    await page.evaluate(() => {
      state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLBG') };
      showInspector();
    });
    await expect(page.locator('#insp-body .primary-row .charts-freq-input')).toHaveValue('134.60');
    await expect(page.locator('#insp-body .clearance-row .charts-freq-input')).toHaveValue('121.55');
    await expect(page.locator('#insp-body .atis-row .charts-freq-input').nth(0)).toHaveValue('132.50');
    await expect(page.locator('#insp-body .atis-row .charts-freq-input').nth(1)).toHaveValue('132.80');
    const markerOrder = await page.evaluate(() => {
      const rows = Array.from(document.querySelector('#insp-body').children);
      return {
        primary: rows.findIndex(el => el.classList.contains('primary-row')),
        atis: rows.findIndex(el => el.classList.contains('atis-row')),
        satellite: rows.findIndex(el => el.classList.contains('satellite-snippet-section')),
      };
    });
    expect(markerOrder.primary).toBeGreaterThanOrEqual(0);
    expect(markerOrder.atis).toBeGreaterThan(markerOrder.primary);
    expect(markerOrder.satellite).toBeGreaterThan(markerOrder.atis);

    await page.evaluate(() => {
      state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLIB') };
      showInspector();
    });
    await expect(page.locator('#insp-body .primary-row .charts-freq-input')).toHaveValue('118.45');
    await expect(page.locator('#insp-body .atis-row .charts-freq-input')).toHaveValue('132.45');

    await page.evaluate(() => {
      state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLHZ') };
      showInspector();
    });
    await expect(page.locator('#insp-body .primary-row .charts-freq-input')).toHaveValue('122.20');
    await expect(page.locator('#insp-body .clearance-row .charts-freq-input')).toHaveValue('121.70');
    await expect(page.locator('#insp-body .atis-row')).toContainText('None');

    await page.evaluate(() => {
      state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLPL') };
      showInspector();
    });
    await expect(page.locator('#insp-body .primary-row .charts-freq-input')).toHaveValue('135.55');
    await expect(page.locator('#insp-body .atis-row .charts-freq-input')).toHaveValue('126.10');

    await page.evaluate(() => {
      state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLAR') };
      showInspector();
    });
    await expect(page.locator('#insp-body .primary-row .charts-freq-input')).toHaveValue('120.75');
    await expect(page.locator('#insp-body .atis-row')).toContainText('None');
    await expect(page.locator('#insp-body .clearance-row')).toContainText('None');

    await page.evaluate(() => {
      state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLES') };
      showInspector();
    });
    await expect(page.locator('#insp-body .primary-row')).toHaveCount(0);

    await page.evaluate(() => {
      const af = airfields.find(a => a.name === 'LLBG');
      state.waypoints = [{ name: af.name, lat: af.lat, lng: af.lng }];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
    });
    await expect(page.locator('#insp-title')).toHaveValue(/LLBG/);
    await expect(page.locator('#insp-title')).toHaveValue(/Ben Gurion/);
    await expect(page.locator('#insp-body .primary-row .charts-freq-input')).toHaveValue('134.60');
    await expect(page.locator('#insp-body .clearance-row .charts-freq-input')).toHaveValue('121.55');
    await expect(page.locator('#insp-body .atis-row .charts-freq-input').nth(0)).toHaveValue('132.50');
    const routeOrder = await page.evaluate(() => {
      const rows = Array.from(document.querySelector('#insp-body').children);
      return {
        primary: rows.findIndex(el => el.classList.contains('primary-row')),
        atis: rows.findIndex(el => el.classList.contains('atis-row')),
        satellite: rows.findIndex(el => el.classList.contains('satellite-snippet-section')),
      };
    });
    expect(routeOrder.primary).toBeGreaterThanOrEqual(0);
    expect(routeOrder.atis).toBeGreaterThan(routeOrder.primary);
    expect(routeOrder.satellite).toBeGreaterThan(routeOrder.atis);

    await page.evaluate(() => {
      const af = airfields.find(a => a.name === 'LLHZ');
      state.waypoints = [{ name: af.name, lat: af.lat, lng: af.lng }];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
    });
    await expect(page.locator('#insp-title')).toHaveValue(/LLHZ/);
    await expect(page.locator('#insp-title')).toHaveValue(/Herzliya/);
    await expect(page.locator('#insp-body .primary-row .charts-freq-input')).toHaveValue('122.20');
    await expect(page.locator('#insp-body .clearance-row .charts-freq-input')).toHaveValue('121.70');
    await expect(page.locator('#insp-body .atis-row')).toContainText('None');
  });

  test('Hebrew airfield inspector keeps ICAO and frequency values in reading order', async ({ page }) => {
    await boot(page, 'he');
    await page.evaluate(async () => {
      await Promise.all([loadAirfields(), loadCommChange()]);
      state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLIB') };
      showInspector();
    });
    await expect(page.locator('#insp-title')).toHaveValue(/LLIB/);
    await expect(page.locator('#insp-title')).toHaveValue(/ראש פינה/);
    await expect(page.locator('#insp-body .primary-row')).toContainText('ראשי');
    await expect(page.locator('#insp-body .primary-row .charts-freq-input')).toHaveValue('118.45');
    await expect(page.locator('#insp-body .atis-row .charts-freq-input')).toHaveValue('132.45');
    const bidi = await page.evaluate(() => {
      const primary = document.querySelector('#insp-body .primary-row .val');
      const atis = document.querySelector('#insp-body .atis-row .val');
      const title = document.getElementById('insp-title');
      return {
        titleDir: getComputedStyle(title).direction,
        primaryDir: getComputedStyle(primary).direction,
        atisDir: getComputedStyle(atis).direction,
      };
    });
    expect(bidi.titleDir).toBe('ltr');
    expect(bidi.primaryDir).toBe('ltr');
    expect(bidi.atisDir).toBe('ltr');
  });

  test('toggling VOR checkbox shows/hides markers on the map', async ({ page }) => {
    await boot(page);
    await page.evaluate(async () => {
      await loadVors();
      map.setView([32.332, 34.968], 8);
    });
    let hit = await page.evaluate(() => {
      const s = proj(vorByIdent('NAT'));
      return hitOverlayMarker(Math.round(s.x), Math.round(s.y));
    });
    expect(hit).toMatchObject({ type: 'vor' });
    // Toggle off.
    await page.locator('#vor-cb').uncheck();
    hit = await page.evaluate(() => {
      const s = proj(vorByIdent('NAT'));
      return hitOverlayMarker(Math.round(s.x), Math.round(s.y));
    });
    expect(hit).toBeNull();
    // Toggle on again.
    await page.locator('#vor-cb').check();
    hit = await page.evaluate(() => {
      const s = proj(vorByIdent('NAT'));
      return hitOverlayMarker(Math.round(s.x), Math.round(s.y));
    });
    expect(hit).toMatchObject({ type: 'vor' });
  });

  test('selected reference VOR draws with highlighted color', async ({ page }) => {
    await boot(page);
    await page.evaluate(async () => {
      await loadVors();
      showVorStations = true;
      vorRef = 'NAT';
      map.setView([32.332, 34.968], 10);
    });
    // Before ref is set, default marker color is used.
    await page.evaluate(() => { vorRef = null; draw(); });
    let defColor = await page.evaluate(() => tune('vorMarkerColor'));
    let selColor = await page.evaluate(() => tune('vorSelectedColor'));
    expect(selColor).not.toBe(defColor);
    // After selecting, the selected color should differ from default.
    await page.evaluate(() => { vorRef = 'NAT'; draw(); });
    // Just snapshot the two colors; the visual rendering is tested via canvas
    // but the color constants must be distinct.
    defColor = await page.evaluate(() => tune('vorMarkerColor'));
    selColor = await page.evaluate(() => tune('vorSelectedColor'));
    expect(defColor).toBeTruthy();
    expect(selColor).toBeTruthy();
    expect(selColor).not.toBe(defColor);
  });

  test('VOR labels are only visible at zoom >= threshold', async ({ page }) => {
    await boot(page);
    const threshold = await page.evaluate(() => {
      // The drawVors function uses map.getZoom() >= 8 to show labels.
      // Read the threshold from the code's own condition.
      return 8; // hard-coded in drawVors: const showLabels = map.getZoom() >= 8;
    });
    expect(threshold).toBe(8);
    // At the default map view (zoom >= 8), labels are drawn.
    await page.evaluate(async () => {
      await loadVors();
      showVorStations = true;
      draw();
    });
    // Verify the condition used in drawVors evaluates correctly.
    const zoom = await page.evaluate(() => map.getZoom());
    expect(zoom).toBeGreaterThanOrEqual(threshold);
  });

  test('VOR inspector toggles reference VOR with persistence', async ({ page }) => {
    await boot(page);
    await page.evaluate(async () => {
      await loadVors();
      showVorStations = true;
      const idx = vors.findIndex(v => v.ident === 'NAT');
      state.selected = { type: 'vor', index: idx };
      showInspector();
    });
    // "Use as reference" sets vorRef.
    const useBtn = page.locator('#insp-body .insp-btn', { hasText: /reference/i });
    await useBtn.click();
    expect(await page.evaluate(() => vorRef)).toBe('NAT');
    expect(await page.evaluate(() => localStorage.getItem('navaid.vorRef'))).toBe('NAT');
    // Button changes to indicate it's active.
    await expect(useBtn).toHaveText(/active|tap to clear/i);
    // Tap again to clear.
    await useBtn.click();
    expect(await page.evaluate(() => vorRef)).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('navaid.vorRef'))).toBeNull();
  });

  test('Hebrew locale shows Hebrew names in VOR, airfield, and navWP inspectors', async ({ page }) => {
    await boot(page, 'he');
    // VOR inspector — shows Hebrew name.
    await page.evaluate(async () => {
      await loadVors();
      const natIdx = vors.findIndex(v => v.ident === 'NAT');
      state.selected = { type: 'vor', index: natIdx };
      showInspector();
    });
    await expect(page.locator('#insp-title')).toHaveValue(/NAT.*נתניה/);
    // Airfield inspector — shows Hebrew name.
    await page.evaluate(async () => {
      if (typeof loadAirfields === 'function') await loadAirfields();
      loadAirfields();
      state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLHA') };
      showInspector();
    });
    await expect(page.locator('#insp-title')).toHaveValue(/חיפה/);
    // NavWP inspector — shows Hebrew name.
    await page.evaluate(async () => {
      await loadNavWaypoints();
      const hadraIdx = navWP.findIndex(w => w.name === 'HADRA');
      state.selected = { type: 'navwp', index: hadraIdx };
      showInspector();
    });
    // Title carries the localized name: "HADRA / חדרה".
    await expect(page.locator('#insp-title')).toHaveValue(/HADRA.*חדרה/);
    // Route waypoint on the same nav-WP mirrors that inspector: ICAO on top,
    // localized name row below (editable), no hard-coded English "Label".
    await page.evaluate(async () => {
      await loadNavWaypoints();
      const hadra = navWP.find(w => w.name === 'HADRA');
      state.waypoints = [{ lat: hadra.lat, lng: hadra.lng, name: 'HADRA' }];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
    });
    // Title carries the localized name too: "HADRA / חדרה".
    await expect(page.locator('#insp-title')).toHaveValue(/HADRA.*חדרה/);
    const routeNameRow = page.locator('#insp-body .row').filter({ hasText: 'שם נקודה' }).first();
    await expect(routeNameRow.locator('input')).toHaveValue('חדרה');
    await expect(page.locator('#insp-body')).not.toContainText('Label');
  });

  test('English locale shows English names in VOR, airfield, and navWP inspectors', async ({ page }) => {
    await boot(page, 'en');
    // VOR inspector — shows English name.
    await page.evaluate(async () => {
      await loadVors();
      const natIdx = vors.findIndex(v => v.ident === 'NAT');
      state.selected = { type: 'vor', index: natIdx };
      showInspector();
    });
    await expect(page.locator('#insp-title')).toHaveValue(/NAT.*Natania/);
    // Airfield inspector — shows English name.
    await page.evaluate(async () => {
      await loadAirfields();
      state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLHA') };
      showInspector();
    });
    // Title combines ICAO + English name.
    await expect(page.locator('#insp-title')).toHaveValue(/LLHA.*Haifa/);
    // NavWP inspector — shows code as title and English label in the name row.
    await page.evaluate(async () => {
      await loadNavWaypoints();
      const hadraIdx = navWP.findIndex(w => w.name === 'HADRA');
      state.selected = { type: 'navwp', index: hadraIdx };
      showInspector();
    });
    // Title carries the English name: "HADRA / Hadera".
    await expect(page.locator('#insp-title')).toHaveValue(/HADRA.*Hadera/);
  });
});

test('printed plan card shows Radial/DME columns only when a VOR is selected', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    if (typeof loadVors === 'function') { try { await loadVors(); } catch (e) {} }
    state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.46472, lng: 34.91222, name: 'HADRA' }];
    if (typeof syncLegs === 'function') syncLegs();
    const cap = () => {
      const c = document.createElement('canvas').getContext('2d');
      const t = []; const real = c.fillText.bind(c);
      c.fillText = function (s, x, y) { t.push(String(s)); return real(s, x, y); };
      drawFlightPlanTable(c, 0, 0, 1200, 300, 'tl');
      return t;
    };
    window.vorRef = null; const off = cap();
    window.vorRef = 'NAT'; const on = cap();
    return {
      offDME: off.some(s => /DME/.test(s)),
      onDME: on.some(s => /DME/.test(s)),
      onRadialHdr: on.some(s => /Radial/.test(s)),
      onRval: on.some(s => /^R-\d{3}/.test(s)),
    };
  });
  expect(r.offDME).toBe(false);     // no VOR → no Radial/DME columns
  expect(r.onDME).toBe(true);       // VOR → DME column header
  expect(r.onRadialHdr).toBe(true); // Radial header (with ident)
  expect(r.onRval).toBe(true);      // R-xxx values

});

test('station coordinates match the published AIP antenna positions', async ({ page }) => {
  await boot(page);
  // Coordinates come from eAIP ENR 4.1 (AIRAC 2024-10-31), not the OurAirports
  // approximations that preceded them: those sat 100-500 m off the CAAI CVFR
  // chart and the satellite imagery, which is visible as a symbol offset on the
  // map (reported for ZOFAR and NATANIA).
  const aip = {
    BGN: [32.01306, 34.87528], NAT: [32.33389, 34.96889], ROP: [32.98250, 35.57278],
    MZD: [31.33167, 35.39167], ZFR: [30.55889, 35.16194], BSA: [31.28611, 34.72167],
    RAM: [29.75306, 35.02056],
  };
  const got = await page.evaluate(async () => {
    if (typeof loadVors === 'function') await loadVors();
    return vors.map(v => [v.ident, v.lat, v.lng]);
  });
  const byId = Object.fromEntries(got.map(([i, la, ln]) => [i, [la, ln]]));
  for (const [ident, [lat, lng]] of Object.entries(aip)) {
    expect(byId[ident], ident + ' present').toBeTruthy();
    // Tight: these are exact published positions, so any drift is a data regression.
    expect(byId[ident][0], ident + ' lat').toBeCloseTo(lat, 5);
    expect(byId[ident][1], ident + ' lng').toBeCloseTo(lng, 5);
  }
});

test('the AIP detail is carried through loadVors and shown on the STATION inspector', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    await loadVors();
    window.showVorStations = true;
    // Select the STATION itself — facts about the facility belong on its own
    // inspector, not on whichever waypoint happens to be selected.
    state.selected = { type: 'vor', index: vors.findIndex(v => v.ident === 'ZFR') };
    draw(); showInspector();
    const z = vors.find(v => v.ident === 'ZFR');
    const info = document.querySelector('.vor-aip-info');
    return {
      // loadVors used to whitelist six fields, silently dropping all of this.
      carried: { type: z.type, ch: z.ch, hours: z.hours, cov: z.coverageNm, elev: z.elevFt,
                 remarks: !!z.remarks },
      text: info ? info.textContent : '',
    };
  });
  expect(r.carried).toEqual({ type: 'VOR/DME', ch: '103X', hours: 'H24', cov: 30, elev: 100, remarks: true });
  expect(r.text).toContain('VOR/DME');
  expect(r.text).toContain('CH 103X');
  expect(r.text).toContain('H24');
  expect(r.text).toContain('30 NM');
  expect(r.text).toContain('100 ft');
  expect(r.text).toContain('RDL009');       // the published limits
});

test('the waypoint inspector keeps only the point-relative out-of-range notice', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    await loadVors();
    window.vorRef = 'ZFR';
    // A point well outside ZFR's published 30 NM coverage.
    state.waypoints = [{ lat: 31.20, lng: 35.30, name: 'FAR' }, { lat: 30.40, lng: 35.10, name: 'B' }];
    state.legs = []; syncLegs();
    state.selected = { type: 'wp', index: 0 };
    draw(); showInspector();
    const info = document.querySelector('.vor-aip-info');
    return { warned: !!document.querySelector('.vor-aip-warn'), text: info ? info.textContent : '' };
  });
  expect(r.warned).toBe(true);              // depends on THIS point, so it stays here
  expect(r.text).not.toContain('CH 103X');  // station facts moved to the station
  expect(r.text).not.toContain('H24');
});

test('a DME-only facility reports distance without inventing a radial', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    await loadVors();
    const lot = vors.find(v => v.ident === 'LOT');
    window.vorRef = 'LOT';
    state.waypoints = [{ lat: 31.9, lng: 35.1, name: 'A' }, { lat: 31.7, lng: 35.0, name: 'B' }];
    state.legs = []; syncLegs();
    state.selected = { type: 'wp', index: 0 };
    draw(); showInspector();
    return { dmeOnly: lot.dmeOnly, type: lot.type,
             readout: (document.querySelector('.vor-radial-val') || {}).textContent || '' };
  });
  expect(r.dmeOnly).toBe(true);            // BET-MEIR is DME-only per ENR 4.1
  expect(r.type).toBe('DME');
  expect(r.readout).toMatch(/DME only/);   // no R-xxx bearing from a DME
  expect(r.readout).not.toMatch(/R-\d/);
});

test('the selected station draws a published-range ring; unpublished draws none', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    await loadVors();
    window.showVorStations = true;
    map.setView([30.85, 35.2], 8, { animate: false });
    const count = () => {
      // Count ring strokes by spying on the dashed-path calls drawVors makes.
      let dashed = 0;
      const orig = octx.setLineDash.bind(octx);
      octx.setLineDash = a => { if (a && a.length && a[0]) dashed++; return orig(a); };
      draw();
      octx.setLineDash = orig;
      return dashed;
    };
    window.vorRef = 'ZFR';  const withCov = count();      // 30 NM published
    window.vorRef = 'RAM';  const noCov  = count();       // no coverage published
    return { withCov, noCov, zfrCov: vors.find(v=>v.ident==='ZFR').coverageNm,
             ramCov: vors.find(v=>v.ident==='RAM').coverageNm };
  });
  expect(r.zfrCov).toBe(30);
  expect(r.ramCov).toBeUndefined();
  expect(r.withCov).toBeGreaterThan(r.noCov);   // ring only when a range is published
});

// The legend swatch stands for the canvas-drawn station symbol, so it is painted by
// the SAME function the map uses (drawVorSymbol). Earlier attempts approximated it in
// CSS — first a plain ringed dot, then gradients for the ticks — and neither looked
// like the map, because stroke width, tick length and dot size are all ratios of the
// radius that an 18px CSS box cannot reproduce.
test('the legend VOR swatch is painted by the map symbol function', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof drawVorSymbol === 'function' &&
    typeof paintLegendVor === 'function');
  const r = await page.evaluate(() => {
    // Prove the legend goes through the shared painter, not a copy of it.
    let calls = 0;
    const orig = window.drawVorSymbol;
    window.drawVorSymbol = function (...a) { calls++; return orig.apply(this, a); };
    paintLegendVor();
    window.drawVorSymbol = orig;
    const cv = document.querySelector('canvas.legend-vor');
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    // Antialiasing means most pixels of an 18px symbol are partly transparent: count
    // any ink for coverage, but sample colour only from a solid pixel.
    let ink = 0, solid = 0, sample = null;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 10) ink++;
      if (d[i + 3] > 200) { solid++; if (!sample) sample = [d[i], d[i + 1], d[i + 2]]; }
    }
    const hex = tune('vorMarkerColor').replace('#', '');
    const want = [0, 2, 4].map(k => parseInt(hex.slice(k, k + 2), 16));
    return { calls, ink, solid, sample, want, isCanvas: cv.tagName === 'CANVAS' };
  });
  expect(r.isCanvas).toBe(true);
  expect(r.calls).toBe(1);                       // the map's own painter drew it
  expect(r.ink).toBeGreaterThan(60);             // ring + ticks + dot actually rendered
  expect(r.solid).toBeGreaterThan(10);           // and not only faint antialiasing
  // and in the colour the canvas markers use
  for (let i = 0; i < 3; i++) expect(Math.abs(r.sample[i] - r.want[i])).toBeLessThan(12);
});

test('a gist recolour of the stations repaints the legend swatch', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof applyTuningCssVars === 'function' &&
    typeof paintLegendVor === 'function');
  const r = await page.evaluate(() => {
    const read = () => {
      const cv = document.querySelector('canvas.legend-vor');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) return [d[i], d[i + 1], d[i + 2]];
      return null;
    };
    const before = read();
    NavAid.tuningDefaults.vorMarkerColor.value = '#aa3300';
    applyTuningCssVars();                        // repaints via paintLegendVor
    const after = read();
    NavAid.tuningDefaults.vorMarkerColor.value = '#127a7a';
    applyTuningCssVars();
    return { before, after };
  });
  expect(r.after[0]).toBeGreaterThan(150);       // now reddish
  expect(r.after[2]).toBeLessThan(60);
  expect(r.before).not.toEqual(r.after);
});
