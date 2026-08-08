// @ts-check
// Regression coverage for mixed Hebrew / Latin UI text. These tests guard the
// places where browser bidi heuristics have previously reordered codes,
// coordinates, dates, and units in confusing ways.
const { test, expect } = require('./_setup');
const { stubGraph } = require('./_layerData');
const { clickToolbarControl, hideToolbarMenus } = require('./_toolbar');

const ALTITUDE_FIXTURE = {
  version: 1,
  source: 'bidi regression fixture',
  segments: [
    {
      from: 'AAKKO',
      to: 'AHIUD',
      distanceNm: 4.3,
      inboundAltitude: null,
      outboundAltitude: 2000,
      oneWay: true,
    },
    {
      from: 'BAZRA',
      to: 'DEROR',
      distanceNm: 2.4,
      inboundAltitude: 800,
      outboundAltitude: 2000,
    },
  ],
};

const COMM_CHANGE_FIXTURE = {
  version: 1,
  source: 'bidi regression fixture',
  callSigns: {
    HERZLIYA: { label: 'Herzliya', he: 'הרצליה', primary: '125.60' },
    PLUTO_WEST: { label: 'Pluto West', he: 'פלוטו מערב', primary: '118.40' },
  },
  points: [
    { name: 'DEROR', commChange: true, callSigns: ['HERZLIYA'] },
    { name: 'DAROM', commChange: true, callSigns: ['PLUTO_WEST'] },
  ],
};

async function boot(page, lang = 'he', init = {}) {
  await page.addInitScript(({ routes }) => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print']) {
        localStorage.setItem('navaid.sec.' + s, '1');
      }
      if (routes) localStorage.setItem('navaid.routes', JSON.stringify(routes));
    } catch (e) {}
  }, init);
  await page.goto('?lang=' + encodeURIComponent(lang));
  await page.waitForFunction(() =>
    typeof state !== 'undefined' &&
    typeof showInspector === 'function' &&
    typeof showAltitudePairsModal === 'function' &&
    typeof showRouteLibraryModal === 'function');
}

async function installBidiFixtures(page) {
  // Both fixtures ride in one graph: the datasets are no longer separate files.
  await stubGraph(page, { segments: ALTITUDE_FIXTURE.segments,
    commChange: COMM_CHANGE_FIXTURE.points, callSigns: COMM_CHANGE_FIXTURE.callSigns });
}

async function cssSnapshot(locator) {
  return locator.evaluate(el => {
    const style = getComputedStyle(el);
    return {
      dirAttr: el.getAttribute('dir') || '',
      direction: style.direction,
      unicodeBidi: style.unicodeBidi,
      textAlign: style.textAlign,
    };
  });
}

test.describe('Bidi / mixed-direction UI regressions', () => {
  test('document direction follows the selected locale', async ({ page }) => {
    await boot(page, 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    expect(await page.evaluate(() => getComputedStyle(document.body).direction)).toBe('ltr');

    await page.goto('?lang=he');
    await page.waitForFunction(() => typeof state !== 'undefined');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    expect(await page.evaluate(() => getComputedStyle(document.body).direction)).toBe('rtl');
  });

  test('Hebrew inspectors and satellite titles keep codes before Hebrew names', async ({ page }) => {
    await boot(page, 'he');
    await page.evaluate(async () => {
      await Promise.all([loadNavWaypoints(), loadAirfields(), loadCommChange()]);
    });

    await page.evaluate(() => {
      const bazra = navWP.find(w => w.name === 'BAZRA');
      state.waypoints = [{ lat: bazra.lat, lng: bazra.lng, name: 'BAZRA' }];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
    });
    await expect(page.locator('#insp-title')).toHaveValue('BAZRA / בצרה');
    let bidi = await cssSnapshot(page.locator('#insp-title'));
    expect(bidi.dirAttr).toBe('auto');
    expect(bidi.direction).toBe('ltr');
    expect(bidi.unicodeBidi).toBe('plaintext');

    await page.evaluate(() => {
      state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLIB') };
      showInspector();
    });
    await expect(page.locator('#insp-title')).toHaveValue('LLIB / ראש פינה');
    // Freq rows are now editable inputs (override-aware); value carries no MHz.
    await expect(page.locator('#insp-body .primary-row .charts-freq-input')).toHaveValue('118.45');
    await expect(page.locator('#insp-body .atis-row .charts-freq-input')).toHaveValue('132.45');
    bidi = await cssSnapshot(page.locator('#insp-title'));
    expect(bidi.direction).toBe('ltr');
    expect((await cssSnapshot(page.locator('#insp-body .primary-row .charts-freq-input'))).direction).toBe('ltr');
    expect((await cssSnapshot(page.locator('#insp-body .atis-row .charts-freq-input'))).direction).toBe('ltr');

    const expectedTitle = await page.evaluate(() => {
      const point = { lat: 32.21861, lng: 34.88250 };
      showSatellitePreviewModal(point, 'BAZRA / בצרה');
      return 'BAZRA / בצרה - ' +
        fmtLatLng(point.lat, 'N', 'S') + ' ' +
        fmtLatLng(point.lng, 'E', 'W');
    });
    const title = page.locator('.satellite-preview-modal .modal-title');
    await expect(title).toHaveText(expectedTitle);
    await expect(title).not.toHaveText(/^[NSWE]/);
    bidi = await cssSnapshot(title);
    expect(bidi.direction).toBe('ltr');
    expect(bidi.unicodeBidi).toContain('isolate');
    const spans = await title.evaluate(el => Array.from(el.querySelectorAll('span')).map(s => ({
      text: s.textContent,
      dir: s.getAttribute('dir'),
      bidi: s.style.unicodeBidi,
    })));
    expect(spans).toEqual([
      { text: 'BAZRA', dir: 'ltr', bidi: 'isolate' },
      { text: 'בצרה', dir: 'rtl', bidi: 'isolate' },
      { text: "32°13.1'N 034°53.0'E", dir: 'ltr', bidi: 'isolate' },
    ]);

    await hideToolbarMenus(page);
    await page.locator('.satellite-preview-modal .modal-close-x').click();
    await expect(page.locator('.satellite-preview-modal')).toHaveCount(0);
    await page.evaluate(() => {
      state.selected = { type: 'navwp', index: navWP.findIndex(w => w.name === 'BAZRA') };
      showInspector();
    });
    await expect(page.locator('#insp-title')).toHaveValue('BAZRA / בצרה');
    await page.locator('#insp-body .satellite-snippet').click();
    await expect(page.locator('.satellite-preview-modal .modal-title')).toHaveText(expectedTitle);
  });

  test('saved routes and templates isolate mixed route names and code paths', async ({ page }) => {
    await boot(page, 'he', {
      routes: [{
        id: 'bidi-route',
        name: 'בדיקה BAZRA DEROR',
        savedAt: '2026-06-15T08:00:00.000Z',
        data: {
          waypoints: [
            { lat: 32.21861, lng: 34.88250, name: 'BAZRA' },
            { lat: 32.25722, lng: 34.89111, name: 'DEROR' },
          ],
          legs: [{ flightSpeed: 90 }],
          notes: [],
        },
      }],
    });

    await clickToolbarControl(page, '#route-library');
    const row = page.locator('.route-library-row').first();
    await expect(row.locator('.route-library-row-name')).toHaveText('בדיקה BAZRA DEROR');
    await expect(row.locator('.route-library-row-meta')).toHaveText('2 WP · 2026-06-15');
    let bidi = await cssSnapshot(row.locator('.route-library-row-name'));
    expect(bidi.dirAttr).toBe('auto');
    expect(bidi.unicodeBidi).toBe('plaintext');
    bidi = await cssSnapshot(row.locator('.route-library-row-meta'));
    expect(bidi.dirAttr).toBe('ltr');
    expect(bidi.direction).toBe('ltr');
    expect(bidi.unicodeBidi).toContain('isolate');

    await hideToolbarMenus(page);
    await page.locator('.route-library-modal .modal-close-x').click();
    await clickToolbarControl(page, '#route-templates');
    const path = page.locator('.route-template-path');
    await expect(path).toBeVisible();
    await expect(path).toContainText('→');
    bidi = await cssSnapshot(path);
    expect(bidi.direction).toBe('ltr');
    expect(bidi.unicodeBidi).toContain('isolate');
  });

  test('Hebrew charts keep altitude, distance, frequency, and code cells isolated', async ({ page }) => {
    await installBidiFixtures(page);
    await boot(page, 'he');
    await page.evaluate(async () => {
      await Promise.all([loadLegAltitudes(), loadCommChange()]);
    });

    await clickToolbarControl(page, '#alt-pairs');
    const heads = page.locator('.charts-alt-table thead th');
    await expect(heads.nth(0)).toHaveText('נתיב');
    await expect(heads.nth(1)).toHaveText('מהראשון לשני');
    await expect(heads.nth(1)).toHaveAttribute(
      'title',
      'גובה בכיוון הנתיב: מהנקודה הראשונה בטור נתיב אל הנקודה השנייה');
    await expect(heads.nth(2)).toHaveText('מהשני לראשון');
    await expect(heads.nth(2)).toHaveAttribute(
      'title',
      'גובה בכיוון ההפוך: מהנקודה השנייה בטור נתיב אל הנקודה הראשונה');
    await expect(heads.nth(3)).toHaveText('כיוון');
    await expect(heads.nth(4)).toHaveText('מ״י');

    const pair = page.locator('.charts-alt-pair').first();
    await expect(pair).toContainText('AAKKO ↔ AHIUD');
    let bidi = await cssSnapshot(pair);
    expect(bidi.direction).toBe('ltr');
    expect(bidi.unicodeBidi).toContain('isolate');
    bidi = await cssSnapshot(page.locator('.charts-alt-input').first());
    expect(bidi.direction).toBe('ltr');
    expect(bidi.unicodeBidi).toContain('isolate');
    bidi = await cssSnapshot(page.locator('.charts-alt-distance').first());
    expect(bidi.direction).toBe('ltr');

    await clickToolbarControl(page, '#freq-table');
    await expect(page.locator('.charts-freq-title h3')).toHaveText('ברירות מחדל לתדרים');
    const code = page.locator('.charts-freq-code', { hasText: 'LLHZ' }).first();
    await expect(code).toBeVisible();
    bidi = await cssSnapshot(code);
    expect(bidi.direction).toBe('ltr');
    expect(bidi.unicodeBidi).toContain('isolate');
    bidi = await cssSnapshot(page.locator('.charts-freq-template').first());
    expect(bidi.direction).toBe('ltr');
    bidi = await cssSnapshot(page.locator('.charts-freq-input').first());
    expect(bidi.direction).toBe('ltr');
  });

  test('Hebrew flight-plan and VOR/DME readouts use stable localized units', async ({ page }) => {
    await boot(page, 'he');
    const vorText = await page.evaluate(async () => {
      await loadVors();
      window.vorRef = 'NAT';
      state.waypoints = [
        { lat: 32.21861, lng: 34.88250, name: 'BAZRA' },
        { lat: 32.25722, lng: 34.89111, name: 'DEROR' },
      ];
      syncLegs();
      draw();
      return vorReadoutText(32.3, 34.9);
    });
    expect(vorText).toMatch(/R-\d{3}° \/ \d/);
    expect(vorText).toContain('NM');
    expect(vorText).not.toContain('מ״י');

    await page.locator('#plan').click();
    await expect(page.locator('.modal-back.flight-plan .modal-title')).toHaveText('תכנית טיסה');
    await expect(page.locator('.flight-table thead th').nth(4)).toHaveText('מרחק (מ״י)');
    await expect(page.locator('.flight-table thead th').nth(11)).toHaveText('רדיאל');
    await expect(page.locator('.flight-table thead th').nth(12)).toHaveText('DME');

    await page.evaluate(() => showExportModal());
    await expect(page.locator('.modal-back:not(.flight-plan) .modal-title')).toHaveText('ייצוא PNG');
    const exportTitleBidi = await cssSnapshot(page.locator('.modal-back:not(.flight-plan) .modal-title'));
    expect(exportTitleBidi.direction).toBe('rtl');
    expect(exportTitleBidi.unicodeBidi).toContain('isolate');
  });

  test('Hebrew zoom readouts stay LTR (z … · …× reads like English)', async ({ page }) => {
    await boot(page, 'he');
    // Main-map readout: same `z<level> · <mult>×` order as English, not RTL —
    // otherwise the × / middle dot get reordered to the wrong side.
    await page.evaluate(() => { map.setZoom(13); showZoom(); });
    await page.waitForFunction(() => map.getZoom() === 13);
    const main = page.locator('#zoom-readout');
    await expect(main).toHaveText('z13 · 2×');
    const mainBidi = await cssSnapshot(main);
    expect(mainBidi.direction).toBe('ltr');
    expect(mainBidi.unicodeBidi).toContain('isolate');

    // Satellite-modal readout matches.
    await page.evaluate(() =>
      showSatellitePreviewModal({ lat: 32.17944, lng: 34.83444 }, 'LLHZ'));
    await page.waitForFunction(() => window.__satModalMap);
    const sat = page.locator('.satellite-zoom-readout');
    await expect(sat).toBeVisible();
    expect((await cssSnapshot(sat)).direction).toBe('ltr');
    await expect(sat).toHaveText(/^z[\d.]+ · [\d.]+×$/);
  });
});
