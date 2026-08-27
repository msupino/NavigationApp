// @ts-check
// The Charts toolbar exposes a dedicated route-wide frequency catalog editor.
// Users can set local call-sign frequencies there, and the overrides should
// use the same navaid.commFreqOverrides store as the inspector editor.
const { test, expect } = require('./_setup');
const { stubGraph } = require('./_layerData');
const { clickToolbarControl, hideToolbarMenus } = require('./_toolbar');

const DEROR = { lat: 32.25722, lng: 34.89111, name: 'DEROR' };
const DAROM = { lat: 32.79611, lng: 34.94333, name: 'DAROM' };

const FIXTURE = {
  version: 1,
  source: 'test fixture',
  callSigns: {
    AZAM: { label: 'Azam', he: 'עזם', primary: '123.70' },
    HERZLIYA: { label: 'Herzliya', he: 'הרצליה', primary: '122.20' },
    PLUTO: { label: 'Pluto', he: 'פלוטו', primary: '118.40' },
  },
  points: [
    { name: 'TYONA', commChange: true, callSigns: ['PLUTO'] },
    { name: 'DEROR', commChange: true, callSigns: ['HERZLIYA'] },
    { name: 'DAROM', commChange: true, callSigns: ['HERZLIYA'] },
  ],
};

const ALTITUDE_FIXTURE = {
  version: 1,
  source: 'test altitude fixture',
  segments: [
    {
      from: 'AAKKO',
      to: 'SMRAT',
      distanceNm: 3.2,
      inboundAltitude: 2500,
      outboundAltitude: 2000,
      status: 'reviewed',
    },
    {
      from: 'DESHE',
      to: 'ZALMN',
      distanceNm: 6.1,
      inboundAltitude: 3000,
      outboundAltitude: 2500,
      status: 'reviewed',
    },
    {
      from: 'EIRON',
      to: 'SDTYM',
      distanceNm: 4.2,
      inboundAltitude: 3000,
      outboundAltitude: null,
      oneWay: true,
      status: 'candidate',
      detection: { greenScore: 0.8 },
    },
    {
      from: 'DEROR',
      to: 'SHARO',
      distanceNm: 4,
      inboundAltitude: null,
      outboundAltitude: null,
      status: 'unknown',
      source: 'test sibling placeholder',
    },
  ],
};

async function installCommChangeFixture(page) {
  // The two fixtures share one file now, so stubGraph accumulates rather than replaces.
  await stubGraph(page, { commChange: FIXTURE.points, callSigns: FIXTURE.callSigns });
}

async function installAltitudeFixture(page) {
  await stubGraph(page, { segments: ALTITUDE_FIXTURE.segments });
}

async function boot(page, lang = 'en') {
  await page.addInitScript(() => {
    try {
      for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
      sessionStorage.clear();
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + s, '1');
    } catch (e) {}
  });
  await page.goto('?lang=' + encodeURIComponent(lang));
  await page.waitForFunction(() => typeof showChartsModal === 'function' &&
    typeof showFreqTableModal === 'function' &&
    typeof showAltitudePairsModal === 'function' &&
    typeof seedCommChangeNotes === 'function');
  await page.evaluate(() => loadNavWaypoints());
  await page.waitForFunction(() => Array.isArray(window.navWP) && window.navWP.length > 0);
  await page.evaluate(() => loadAirfields());
  await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
  await page.evaluate(() => loadCommChange());
  await page.waitForFunction(() => window.commChangeMap && window.commChangeMap.DEROR);
}

test.describe('Charts modal — frequency catalog table', () => {
  test('Charts toolbar section exposes the frequency table entry point', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const button = page.locator('.tb-section[data-sec="charts"] #freq-table');
    await expect(button).toBeVisible();
    await expect(button).toHaveText('📡 Freq table');

    await button.click();
    await expect(page.locator('.charts-freq-title h3')).toHaveText('Frequency defaults');
    // The value in force first, then where it came from, then what the book says it was.
    await expect(page.locator('.charts-freq-table thead th').nth(1))
      .toHaveText('Override');
    await expect(page.locator('.charts-freq-table thead th').nth(2))
      .toHaveText('Source');
    await expect(page.locator('.charts-freq-table thead th').nth(3))
      .toHaveText('Default');
    const herzliya = page.locator('.charts-freq-input[data-call-sign="HERZLIYA"]');
    await expect(herzliya).toHaveAttribute('type', 'number');
    await expect(herzliya).toHaveAttribute('min', '118');
    await expect(herzliya).toHaveAttribute('max', '136.975');
    await expect(herzliya).toHaveAttribute('step', '0.005');
    await expect(herzliya).toHaveValue('122.20');
    await expect(herzliya).toHaveClass(/is-default/);
    await expect(page.locator('.charts-freq-input[data-call-sign="AZAM"]'))
      .toHaveCount(0);
    await expect(page.locator('.charts-field')).toHaveCount(0);
    await expect(page.locator('.charts-alt-title')).toHaveCount(0);
  });

  test('Charts toolbar section exposes learned altitude pairs with JSON copy', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await installCommChangeFixture(page);
    await installAltitudeFixture(page);
    await boot(page);
    const button = page.locator('.tb-section[data-sec="charts"] #alt-pairs');
    await expect(button).toBeVisible();
    await expect(button).toHaveText('🧭 Alt pairs');

    await button.click();
    await expect(page.locator('.charts-alt-title h3')).toHaveText('CVFR altitude pairs');
    const resetAll = page.locator('.charts-alt-reset-all');
    await expect(resetAll).toHaveText('↻ Reset all');
    await expect(resetAll).toHaveAttribute('title', 'Revert all altitude pairs to origin');
    await expect(resetAll).toBeDisabled();
    await expect(page.locator('.charts-alt-table thead th').nth(3)).toHaveText('Direction');
    await expect(page.locator('.charts-alt-table tbody tr')).toHaveCount(4);
    await expect(page.locator('.charts-freq-title')).toHaveCount(0);
    await expect(page.locator('.charts-field')).toHaveCount(0);

    const aakkoRow = page.locator('.charts-alt-table tbody tr', { hasText: 'AAKKO ↔ SMRAT' });
    const desheRow = page.locator('.charts-alt-table tbody tr', { hasText: 'DESHE ↔ ZALMN' });
    const desheInputs = desheRow.locator('.charts-alt-input');
    await expect(desheInputs.nth(0)).toHaveAttribute('type', 'number');
    await expect(desheInputs.nth(0)).toHaveValue('3000');
    await expect(desheInputs.nth(0)).toHaveClass(/is-default/);
    await expect(desheInputs.nth(1)).toHaveValue('2500');
    await expect(desheInputs.nth(1)).toHaveClass(/is-default/);
    await expect(desheRow).toContainText('Two way');
    const desheDirectionResets = desheRow.locator('.charts-alt-cell-reset');
    await expect(desheDirectionResets).toHaveCount(2);
    await expect(desheDirectionResets.nth(0))
      .toHaveAttribute('title', 'Revert this direction to origin');
    await expect(desheDirectionResets.nth(0)).toBeDisabled();
    await expect(desheDirectionResets.nth(1)).toBeDisabled();
    const desheReset = desheRow.locator('.charts-alt-reset');
    await expect(desheReset).toHaveAttribute('title', 'Revert to origin');
    await expect(desheReset).toBeDisabled();
    const eironRow = page.locator('.charts-alt-table tbody tr', { hasText: 'EIRON ↔ SDTYM' });
    await expect(eironRow.locator('.charts-alt-input').nth(0)).toHaveValue('3000');
    await expect(eironRow.locator('.charts-alt-input').nth(1))
      .toHaveAttribute('placeholder', 'Blocked');
    await expect(eironRow).toContainText('One way');
    const derorRow = page.locator('.charts-alt-table tbody tr', { hasText: 'DEROR ↔ SHARO' });
    const derorInputs = derorRow.locator('.charts-alt-input');
    await expect(derorInputs.nth(0)).toHaveAttribute('placeholder', 'Unknown');
    await expect(derorInputs.nth(1)).toHaveAttribute('placeholder', 'Unknown');
    await expect(derorRow).toContainText('Unknown');

    const search = page.locator('.charts-alt-search');
    await expect(search).toHaveAttribute('placeholder', 'Search altitude pairs');
    await search.fill('smrat aakko');
    await expect(aakkoRow).toBeVisible();
    await expect(desheRow).toBeHidden();
    await expect(eironRow).toBeHidden();
    await expect(derorRow).toBeHidden();
    await expect.poll(() => page.evaluate(() => {
      const layer = window.altitudePairFocusLayer;
      return Boolean(layer && map.hasLayer(layer) && window.altitudePairFocusSource === 'search');
    })).toBe(true);
    await search.fill('smrat');
    await expect(aakkoRow).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.altitudePairFocusLayer === null)).toBe(true);
    await search.fill('zalmn deshe');
    await expect(aakkoRow).toBeHidden();
    await expect(desheRow).toBeVisible();
    await expect(eironRow).toBeHidden();
    await expect(derorRow).toBeHidden();
    await search.fill('eiron');
    await expect(eironRow).toBeVisible();
    await expect(desheRow).toBeHidden();
    await expect(derorRow).toBeHidden();
    await search.fill('deror');
    await expect(derorRow).toBeVisible();
    await expect(eironRow).toBeHidden();
    await search.fill('nope');
    await expect(page.locator('.charts-alt-no-matches'))
      .toHaveText('No matching altitude pairs');

    await search.fill('');
    await desheInputs.nth(0).fill('3100');
    await desheInputs.nth(0).blur();
    await expect(resetAll).toBeEnabled();
    await expect(desheReset).toBeEnabled();
    await expect(desheRow).toHaveClass(/overridden/);
    await expect(desheInputs.nth(0)).not.toHaveClass(/is-default/);
    await expect(desheInputs.nth(1)).toHaveClass(/is-default/);
    await expect(desheDirectionResets.nth(0)).toBeEnabled();
    await expect(desheDirectionResets.nth(1)).toBeDisabled();
    await desheInputs.nth(1).fill('2600');
    await desheInputs.nth(1).blur();
    await expect(desheDirectionResets.nth(0)).toBeEnabled();
    await expect(desheDirectionResets.nth(1)).toBeEnabled();
    await desheDirectionResets.nth(1).click();
    await expect(desheInputs.nth(0)).toHaveValue('3100');
    await expect(desheInputs.nth(0)).not.toHaveClass(/is-default/);
    await expect(desheInputs.nth(1)).toHaveValue('2500');
    await expect(desheInputs.nth(1)).toHaveClass(/is-default/);
    await expect(desheDirectionResets.nth(0)).toBeEnabled();
    await expect(desheDirectionResets.nth(1)).toBeDisabled();
    await expect(desheReset).toBeEnabled();
    await derorInputs.nth(0).fill('1500');
    await derorInputs.nth(0).blur();
    await derorInputs.nth(1).fill('2000');
    await derorInputs.nth(1).blur();
    await page.locator('.charts-alt-copy').click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    const copied = JSON.parse(clip);
    const copiedDeshe = copied.segments.find(s => s.from === 'DESHE' && s.to === 'ZALMN');
    const copiedDeror = copied.segments.find(s => s.from === 'DEROR' && s.to === 'SHARO');
    expect(copiedDeshe.inboundAltitude).toBe(3100);
    expect(copiedDeror).toMatchObject({
      from: 'DEROR',
      to: 'SHARO',
      inboundAltitude: 1500,
      outboundAltitude: 2000,
      status: 'candidate',
    });
    expect(copiedDeror).not.toHaveProperty('oneWay');
    // The copy is the shape the app ships -- segments only. directionPool is derived, not
    // stored, and a copy carrying it could not be diffed against the shipped projection.
    expect(copied).not.toHaveProperty('directionPool');

    await desheReset.click();
    await expect(desheInputs.nth(0)).toHaveValue('3000');
    await expect(desheInputs.nth(0)).toHaveClass(/is-default/);
    await expect(desheInputs.nth(1)).toHaveValue('2500');
    await expect(desheInputs.nth(1)).toHaveClass(/is-default/);
    await expect(desheDirectionResets.nth(0)).toBeDisabled();
    await expect(desheDirectionResets.nth(1)).toBeDisabled();
    await expect(desheReset).toBeDisabled();
    await expect(desheRow).not.toHaveClass(/overridden/);
    await expect(resetAll).toBeEnabled();
    await expect.poll(() => page.evaluate(() => {
      const raw = legAltitudeDataset.segments
        .find(s => s.from === 'DESHE' && s.to === 'ZALMN');
      const lookup = legAltitudeMap['DESHE-ZALMN'];
      return {
        raw: [
          raw.inboundAltitude,
          raw.outboundAltitude,
          raw.oneWay === true,
          raw.status,
        ],
        lookup: [
          lookup.inboundAltitude,
          lookup.outboundAltitude,
          lookup.oneWay === true,
          lookup.status,
        ],
      };
    })).toEqual({
      raw: [3000, 2500, false, 'reviewed'],
      lookup: [3000, 2500, false, 'reviewed'],
    });

    await resetAll.click();
    await expect(resetAll).toBeDisabled();
    await expect(derorInputs.nth(0)).toHaveValue('');
    await expect(derorInputs.nth(0)).toHaveAttribute('placeholder', 'Unknown');
    await expect(derorInputs.nth(1)).toHaveValue('');
    await expect(derorInputs.nth(1)).toHaveAttribute('placeholder', 'Unknown');
    await expect(derorRow).not.toHaveClass(/overridden/);
    await expect.poll(() => page.evaluate(() => {
      const raw = legAltitudeDataset.segments
        .find(s => s.from === 'DEROR' && s.to === 'SHARO');
      const lookup = legAltitudeMap['DEROR-SHARO'];
      return {
        raw: [
          raw.inboundAltitude,
          raw.outboundAltitude,
          raw.oneWay === true,
          raw.status,
        ],
        lookup: [
          lookup.inboundAltitude,
          lookup.outboundAltitude,
          lookup.oneWay === true,
          lookup.status,
        ],
      };
    })).toEqual({
      raw: [null, null, false, 'unknown'],
      lookup: [null, null, false, 'unknown'],
    });
  });

  test('altitude pair labels focus the map on the selected leg', async ({ page }) => {
    await installCommChangeFixture(page);
    await installAltitudeFixture(page);
    await boot(page);
    await clickToolbarControl(page, '#alt-pairs');

    const modal = page.locator('.charts-alt-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.modal-close-actions .modal-close-x')).toHaveCount(1);
    await expect(modal.locator('.charts-alt-title-actions .charts-alt-pin')).toHaveCount(0);
    expect(await modal.evaluate(el => {
      const style = getComputedStyle(el);
      return { resize: style.resize, overflow: style.overflow, minHeight: style.minHeight };
    })).toEqual({ resize: 'both', overflow: 'hidden', minHeight: '220px' });
    const desheRow = page.locator('.charts-alt-table tbody tr', { hasText: 'DESHE ↔ ZALMN' });
    const pin = modal.locator('.modal-close-actions .charts-alt-pin');
    await expect(pin).toHaveText('📌');
    await expect(pin).toHaveAttribute('title', 'Keep Alt pairs open when focusing a pair');
    await expect(pin).toHaveAttribute('aria-pressed', 'false');
    await expect(desheRow.locator('.charts-alt-pair-button'))
      .toHaveAttribute('aria-label', 'Go to DESHE ↔ ZALMN');
    await hideToolbarMenus(page);
    await desheRow.locator('.charts-alt-pair-button').click();

    await expect(page.locator('.charts-alt-title')).toHaveCount(0);
    const focused = await page.waitForFunction(() => {
      const from = navWP.find(p => p.name === 'DESHE');
      const to = navWP.find(p => p.name === 'ZALMN');
      if (!from || !to) return null;
      const bounds = map.getBounds();
      const layer = window.altitudePairFocusLayer;
      const fromVisible = bounds.contains([from.lat, from.lng]);
      const toVisible = bounds.contains([to.lat, to.lng]);
      const hasFocusLayer = Boolean(layer && map.hasLayer(layer));
      const focusMembers = layer ? Object.values(layer._layers || {}) : [];
      const focusLine = focusMembers.find(item =>
        String(item.options && item.options.className || '').includes('alt-pair-focus-line'));
      const focusDots = focusMembers.filter(item =>
        String(item.options && item.options.className || '').includes('alt-pair-focus-dot'));
      if (!fromVisible || !toVisible || !hasFocusLayer || !focusLine || focusDots.length !== 2) return null;
      return {
        fromVisible,
        toVisible,
        hasFocusLayer,
        focusLineColor: focusLine.options.color,
        focusLineClass: focusLine.options.className,
        focusDotColors: focusDots.map(item => item.options.fillColor),
        focusDotClasses: focusDots.map(item => item.options.className),
        routeWaypoints: state.waypoints.length,
        routeLegs: state.legs.length,
      };
    });

    expect(await focused.jsonValue()).toEqual({
      fromVisible: true,
      toVisible: true,
      hasFocusLayer: true,
      focusLineColor: '#ff3030',
      focusLineClass: 'alt-pair-focus-line alt-pair-focus-blink',
      focusDotColors: ['#ff3030', '#ff3030'],
      focusDotClasses: [
        'alt-pair-focus-dot alt-pair-focus-blink',
        'alt-pair-focus-dot alt-pair-focus-blink',
      ],
      routeWaypoints: 0,
      routeLegs: 0,
    });

    await clickToolbarControl(page, '#alt-pairs');
    await expect(pin).toHaveAttribute('aria-pressed', 'false');
    await pin.click();
    await expect(pin).toHaveAttribute('aria-pressed', 'true');
    await expect(pin).toHaveAttribute('title', 'Alt pairs stays open when focusing a pair');
    await expect(pin).toHaveClass(/is-pinned/);
    await page.evaluate(() => setTune('altPairFocusMs', 1000));
    await hideToolbarMenus(page);
    await desheRow.locator('.charts-alt-pair-button').click();
    await expect(page.locator('.charts-alt-title')).toBeVisible();
    await expect(pin).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(1200);
    await expect.poll(() => page.evaluate(() => {
      const layer = window.altitudePairFocusLayer;
      return Boolean(layer && map.hasLayer(layer));
    })).toBe(true);
    await modal.locator('.modal-close-actions .modal-close-x').click();
    await expect(page.locator('.charts-alt-title')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.altitudePairFocusLayer === null)).toBe(true);
  });

  test('leg inspector altitude edits refresh the open altitude pairs chart', async ({ page }) => {
    await installCommChangeFixture(page);
    await installAltitudeFixture(page);
    await boot(page);
    await page.evaluate(async () => {
      await loadLegAltitudes();
      const byName = name => navWP.find(p => p.name === name);
      state.waypoints = [byName('DESHE'), byName('ZALMN')]
        .map(p => ({ lat: p.lat, lng: p.lng, name: p.name }));
      state.legs = [];
      syncLegs();
      state.selected = { type: 'leg', index: 0 };
      showInspector();
      draw();
    });

    await clickToolbarControl(page, '#alt-pairs');
    const desheRow = page.locator('.charts-alt-table tbody tr', { hasText: 'DESHE ↔ ZALMN' });
    await expect(desheRow.locator('.charts-alt-input').nth(0)).toHaveValue('3000');
    await page.locator('#insp-body input[type=number]').nth(1)
      .evaluate(input => {
        input.value = '3300';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    await expect(desheRow.locator('.charts-alt-input').nth(0)).toHaveValue('3300');
    await expect(desheRow.locator('.charts-alt-input').nth(1)).toHaveValue('2500');

    await page.evaluate(() => {
      const byName = name => navWP.find(p => p.name === name);
      state.waypoints = [byName('ZALMN'), byName('DESHE')]
        .map(p => ({ lat: p.lat, lng: p.lng, name: p.name }));
      state.legs = [];
      syncLegs();
      state.selected = { type: 'leg', index: 0 };
      showInspector();
      draw();
    });
    await page.locator('#insp-body input[type=number]').nth(1)
      .evaluate(input => {
        input.value = '2600';
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    await expect(desheRow.locator('.charts-alt-input').nth(0)).toHaveValue('3300');
    await expect(desheRow.locator('.charts-alt-input').nth(1)).toHaveValue('2600');
    await expect.poll(() => page.evaluate(() => {
      const segment = legAltitudeDataset.segments.find(s => s.from === 'DESHE' && s.to === 'ZALMN');
      return [segment.inboundAltitude, segment.outboundAltitude];
    })).toEqual([3300, 2600]);
  });

  test('Hebrew labels call altitude pairs routes', async ({ page }) => {
    await installCommChangeFixture(page);
    await installAltitudeFixture(page);
    await boot(page, 'he');
    const button = page.locator('.tb-section[data-sec="charts"] #alt-pairs');
    await expect(button).toHaveText('🧭 נתיבים');
    await expect(button).toHaveAttribute('title', 'הצג והעתק נתיבי CVFR שנלמדו');

    await button.click();
    await expect(page.locator('.charts-alt-title h3')).toHaveText('נתיבי CVFR');
    await expect(page.locator('.modal-close-actions .charts-alt-pin'))
      .toHaveAttribute('title', 'השאר את חלון הנתיבים פתוח במיקוד נתיב');
    await expect(page.locator('.charts-alt-search')).toHaveAttribute('placeholder', 'חפש נתיבים');
    await expect(page.locator('.charts-alt-table thead th').first()).toHaveText('נתיב');
    await expect(page.locator('.charts-alt-table thead th').nth(1))
      .toHaveText('מהראשון לשני');
    await expect(page.locator('.charts-alt-table thead th').nth(1))
      .toHaveAttribute('title', 'גובה בכיוון הנתיב: מהנקודה הראשונה בטור נתיב אל הנקודה השנייה');
    await expect(page.locator('.charts-alt-table thead th').nth(2))
      .toHaveText('מהשני לראשון');
    await expect(page.locator('.charts-alt-table thead th').nth(2))
      .toHaveAttribute('title', 'גובה בכיוון ההפוך: מהנקודה השנייה בטור נתיב אל הנקודה הראשונה');
    await expect(page.locator('.charts-alt-table thead th').nth(3)).toHaveText('כיוון');
    await expect(page.locator('.charts-alt-table thead th').nth(4)).toHaveText('מ״י');
  });

  test('Airport charts entry point stays chart-only', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.locator('#charts').click();
    await expect(page.locator('.charts-field').first()).toBeVisible();
    await expect(page.locator('.charts-freq-title')).toHaveCount(0);
    await expect(page.locator('.charts-freq-table')).toHaveCount(0);
    await expect(page.locator('.charts-alt-title')).toHaveCount(0);
    await expect(page.locator('.charts-alt-table')).toHaveCount(0);
  });

  test('search filters frequency table rows', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.locator('#freq-table').click();

    const search = page.locator('.charts-freq-search');
    await expect(search).toHaveAttribute('placeholder', 'Search frequencies');
    await expect(page.locator('.charts-freq-input[data-call-sign="HERZLIYA"]'))
      .toBeVisible();
    await expect(page.locator('.charts-freq-input[data-call-sign="PLUTO"]'))
      .toBeVisible();
    await expect(page.locator('.charts-freq-input[data-call-sign="AZAM"]'))
      .toHaveCount(0);

    await search.fill('plu');
    await expect(page.locator('.charts-freq-input[data-call-sign="PLUTO"]'))
      .toBeVisible();
    await expect(page.locator('.charts-freq-input[data-call-sign="HERZLIYA"]'))
      .toBeHidden();
    await expect(page.locator('.charts-freq-no-matches')).toBeHidden();

    await search.fill('122.20');
    await expect(page.locator('.charts-freq-input[data-call-sign="HERZLIYA"]'))
      .toBeVisible();
    await expect(page.locator('.charts-freq-input[data-call-sign="PLUTO"]'))
      .toBeHidden();

    await search.fill('azam');
    await expect(page.locator('.charts-freq-no-matches'))
      .toHaveText('No matching frequencies');

    await search.fill('nope');
    await expect(page.locator('.charts-freq-input[data-call-sign="HERZLIYA"]'))
      .toBeHidden();
    await expect(page.locator('.charts-freq-input[data-call-sign="PLUTO"]'))
      .toBeHidden();
    await expect(page.locator('.charts-freq-no-matches'))
      .toHaveText('No matching frequencies');
  });

  test('edits local frequencies and restores originals', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.evaluate(({ deror, darom }) => {
      localStorage.removeItem('navaid.commFreqOverrides');
      window.showCommChange = true;
      state.waypoints = [deror, darom];
      state.notes = [];
      syncLegs();
      seedCommChangeNotes();
      showFreqTableModal();
    }, { deror: DEROR, darom: DAROM });

    const herzliya = page.locator('.charts-freq-input[data-call-sign="HERZLIYA"]');
    const pluto = page.locator('.charts-freq-input[data-call-sign="PLUTO"]');
    const restoreAll = page.locator('.charts-freq-restore-all');
    const herzliyaRow = page.locator('.charts-freq-table tr', {
      has: page.locator('.charts-freq-input[data-call-sign="HERZLIYA"]'),
    });
    const herzliyaReset = herzliyaRow.locator('.commchange-freq-reset');

    await expect(page.locator('.charts-freq-title h3')).toHaveText('Frequency defaults');
    await expect(herzliya).toHaveValue('122.20');
    await expect(herzliya).toHaveClass(/is-default/);
    await expect(pluto).toHaveValue('118.40');
    await expect(pluto).toHaveClass(/is-default/);
    await expect(restoreAll).toBeDisabled();
    await expect(herzliyaReset).toBeDisabled();
    await expect(herzliyaRow).not.toHaveClass(/overridden/);

    await herzliya.fill('137.00');
    await herzliya.press('Enter');
    await expect(herzliya).toHaveAttribute('aria-invalid', 'true');
    await expect(herzliya).not.toHaveClass(/is-default/);
    await expect(restoreAll).toBeDisabled();
    await expect(herzliyaReset).toBeEnabled();
    expect(await page.evaluate(() => localStorage.getItem('navaid.commFreqOverrides'))).toBeNull();
    await herzliyaReset.click();
    await expect(herzliya).toHaveValue('122.20');
    await expect(herzliya).toHaveClass(/is-default/);
    await expect(herzliya).toHaveAttribute('aria-invalid', 'false');
    await expect(herzliyaReset).toBeDisabled();

    await herzliya.fill('125.60');
    await herzliya.press('Enter');
    await expect(restoreAll).toBeEnabled();
    await expect(herzliyaReset).toBeEnabled();
    await expect(herzliya).toHaveValue('125.60');
    await expect(herzliya).not.toHaveClass(/is-default/);
    await expect(herzliyaRow).toHaveClass(/overridden/);

    const edited = await page.evaluate(() => ({
      overrides: JSON.parse(localStorage.getItem('navaid.commFreqOverrides') || '{}'),
      notes: state.notes.map(n => ({
        cc: n.cc,
        freqName: n.freqName,
        freq: n.freq,
        lines: noteLines(n),
      })),
    }));
    expect(edited.overrides).toEqual({ HERZLIYA: '125.60' });
    expect(edited.notes).toEqual([
      { cc: 'DEROR', freqName: 'HERZLIYA', freq: '125.60', lines: ['HERZLIYA', '125.60'] },
      { cc: 'DAROM', freqName: 'HERZLIYA', freq: '125.60', lines: ['HERZLIYA', '125.60'] },
    ]);

    await herzliyaReset.click();
    await expect(herzliya).toHaveValue('122.20');
    await expect(herzliya).toHaveClass(/is-default/);
    await expect(restoreAll).toBeDisabled();
    await expect(herzliyaReset).toBeDisabled();
    await expect(herzliyaRow).not.toHaveClass(/overridden/);
    const rowRestored = await page.evaluate(() => ({
      rawOverrides: localStorage.getItem('navaid.commFreqOverrides'),
      notes: state.notes.map(n => ({
        cc: n.cc,
        freqName: n.freqName,
        freq: n.freq,
        lines: noteLines(n),
      })),
    }));
    expect(rowRestored.rawOverrides).toBeNull();
    expect(rowRestored.notes).toEqual([
      { cc: 'DEROR', freqName: 'HERZLIYA', freq: '122.20', lines: ['HERZLIYA', '122.20'] },
      { cc: 'DAROM', freqName: 'HERZLIYA', freq: '122.20', lines: ['HERZLIYA', '122.20'] },
    ]);

    await herzliya.fill('125.60');
    await herzliya.press('Enter');
    await pluto.fill('119.20');
    await pluto.press('Enter');
    await expect(restoreAll).toBeEnabled();
    await restoreAll.click();
    await expect(herzliya).toHaveValue('122.20');
    await expect(pluto).toHaveValue('118.40');
    await expect(restoreAll).toBeDisabled();
    expect(await page.evaluate(() => localStorage.getItem('navaid.commFreqOverrides'))).toBeNull();
  });
});
