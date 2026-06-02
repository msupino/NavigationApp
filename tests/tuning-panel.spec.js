// @ts-check
// Hidden developer tuning panel (?tune=1): session-only controls that preview
// drawing constants without writing persistence keys.
const { test, expect } = require('./_setup');

async function boot(page, url = '?lang=en&tune=1') {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {}
  });
  await page.goto(url);
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof draw === 'function');
}

async function openTuneGroup(page, name) {
  await page.locator('#tuning-panel summary').filter({ hasText: new RegExp('^' + name + '$') }).click();
}

async function captureDrift(page) {
  return page.evaluate(() => {
    const dashCalls = [];
    const segments = [];
    const realSave = octx.save.bind(octx);
    const realRestore = octx.restore.bind(octx);
    const realSetLineDash = octx.setLineDash.bind(octx);
    const realBeginPath = octx.beginPath.bind(octx);
    const realMoveTo = octx.moveTo.bind(octx);
    const realLineTo = octx.lineTo.bind(octx);
    const realStroke = octx.stroke.bind(octx);
    let last = null;
    octx.save = function () {};
    octx.restore = function () {};
    octx.setLineDash = function (dash) { dashCalls.push(Array.from(dash)); };
    octx.beginPath = function () { last = null; };
    octx.moveTo = function (x, y) { last = { x, y }; };
    octx.lineTo = function (x, y) {
      if (last) segments.push(Math.hypot(x - last.x, y - last.y));
      last = { x, y };
    };
    octx.stroke = function () {};
    drawDriftLines({ x: 0, y: 0 }, { x: 100, y: 0 });
    octx.save = realSave;
    octx.restore = realRestore;
    octx.setLineDash = realSetLineDash;
    octx.beginPath = realBeginPath;
    octx.moveTo = realMoveTo;
    octx.lineTo = realLineTo;
    octx.stroke = realStroke;
    return { dash: dashCalls[0], segments, value: tune('driftDashOnPx') };
  });
}

test.describe('Hidden tuning panel', () => {
  test('is hidden unless the tune query flag is present', async ({ page }) => {
    await boot(page, '?lang=en');
    await expect(page.locator('#tuning-panel')).toHaveCount(0);
  });

  test('opens with ?tune=1 and preserves the flag when lang is added', async ({ page }) => {
    await boot(page, '?tune=1');
    await expect(page.locator('#tuning-panel')).toBeVisible();
    const params = new URL(page.url()).searchParams;
    expect(params.get('tune')).toBe('1');
    expect(params.get('lang')).toBe('en');
  });

  test('groups start collapsed', async ({ page }) => {
    await boot(page);
    expect(await page.locator('#tuning-panel details[open]').count()).toBe(0);
  });

  test('exposes every tuning default through tune() and the panel', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => {
      const defaults = NavAid.tuningDefaults || {};
      const groupKeys = (NavAid.tuningGroups || []).flatMap(g => g.keys || []);
      const missingDefaults = groupKeys.filter(key => !defaults[key]);
      const duplicateGroupKeys = groupKeys.filter((key, i) => groupKeys.indexOf(key) !== i);
      const rows = Object.entries(defaults).map(([key, spec]) => {
        const value = tune(key);
        const type = spec.type || 'number';
        return {
          key,
          type,
          value,
          defaultValue: spec.value,
          inGroup: groupKeys.includes(key),
          hasReset: !!document.getElementById('tune-' + key + '-reset'),
          hasRange: !!document.getElementById('tune-' + key + '-range'),
          hasNumber: !!document.getElementById('tune-' + key + '-number'),
          hasColor: !!document.getElementById('tune-' + key + '-color'),
          hasText: !!document.getElementById('tune-' + key + '-text'),
          hasSelect: !!document.getElementById('tune-' + key + '-select'),
        };
      });
      return { rows, missingDefaults, duplicateGroupKeys };
    });

    expect(out.missingDefaults).toEqual([]);
    expect(out.duplicateGroupKeys).toEqual([]);
    expect(out.rows.filter(row => !row.inGroup).map(row => row.key)).toEqual([]);
    expect(out.rows.filter(row => row.value !== row.defaultValue).map(row => row.key)).toEqual([]);
    expect(out.rows.filter(row => !row.hasReset).map(row => row.key)).toEqual([]);
    expect(out.rows.filter(row => row.type === 'number' && (!row.hasRange || !row.hasNumber)).map(row => row.key)).toEqual([]);
    expect(out.rows.filter(row => row.type === 'color' && (!row.hasColor || !row.hasText)).map(row => row.key)).toEqual([]);
    expect(out.rows.filter(row => row.type === 'select' && !row.hasSelect).map(row => row.key)).toEqual([]);
  });

  test('uses the tuned marker and kite defaults', async ({ page }) => {
    await boot(page);
    const values = await page.evaluate(() => ({
      defaultLabelMarginPx: tune('defaultLabelMarginPx'),
      legKiteHeightPx: tune('legKiteHeightPx'),
      legKiteCellWidthPx: tune('legKiteCellWidthPx'),
      legKiteTriangleLenPx: tune('legKiteTriangleLenPx'),
      legKiteHeadingTextPx: tune('legKiteHeadingTextPx'),
      legKiteHeadingAnchor: tune('legKiteHeadingAnchor'),
      cumKiteHeightPx: tune('cumKiteHeightPx'),
      cumKiteCellWidthPx: tune('cumKiteCellWidthPx'),
      cumKiteTextPx: tune('cumKiteTextPx'),
    }));
    expect(values).toEqual({
      defaultLabelMarginPx: 20,
      legKiteHeightPx: 47,
      legKiteCellWidthPx: 24,
      legKiteTriangleLenPx: 35,
      legKiteHeadingTextPx: 13,
      legKiteHeadingAnchor: 0.25,
      cumKiteHeightPx: 23,
      cumKiteCellWidthPx: 43,
      cumKiteTextPx: 15,
    });
  });

  test('drift dash controls redraw without changing endpoint length', async ({ page }) => {
    await boot(page);
    await openTuneGroup(page, 'Drift lines');
    await page.locator('#tune-driftDashOnPx-number').fill('24');

    const out = await captureDrift(page);
    expect(out.value).toBe(24);
    expect(out.dash).toEqual([24, 8]);
    expect(out.segments).toHaveLength(2);
    expect(out.segments[0]).toBeCloseTo(50, 5);
    expect(out.segments[1]).toBeCloseTo(50, 5);

    await page.locator('#tune-driftDashOnPx-reset').click();
    const reset = await captureDrift(page);
    expect(reset.value).toBe(12);
    expect(reset.dash).toEqual([12, 8]);
  });

  test('preview values reset on reload and do not add persistence keys', async ({ page }) => {
    await boot(page);
    await openTuneGroup(page, 'Route');
    await page.locator('#tune-routeLineWidthPx-number').fill('9');
    expect(await page.evaluate(() => tune('routeLineWidthPx'))).toBe(9);
    expect(await page.evaluate(() =>
      Object.keys(localStorage).filter(k => k.indexOf('navaid.tune') === 0)
    )).toEqual([]);

    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && typeof tune === 'function');
    expect(await page.evaluate(() => tune('routeLineWidthPx'))).toBe(3.5);
    await expect(page.locator('#tune-routeLineWidthPx-number')).toHaveValue('3.5');
  });

  test('color and select controls update preview values', async ({ page }) => {
    await boot(page);
    await openTuneGroup(page, 'Reference overlays');
    await page.locator('#tune-commChangeArrowColor-text').fill('#336699');
    await page.locator('#tune-commChangeArrowLineCap-select').selectOption('round');

    const out = await page.evaluate(() => ({
      color: tune('commChangeArrowColor'),
      cap: tune('commChangeArrowLineCap'),
      persisted: Object.keys(localStorage).filter(k => k.indexOf('navaid.tune') === 0),
    }));
    expect(out.color).toBe('#336699');
    expect(out.cap).toBe('round');
    expect(out.persisted).toEqual([]);
  });

  test('close button hides the panel', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#tuning-panel')).toBeVisible();
    await page.locator('#tuning-panel .tune-close').click();
    await expect(page.locator('#tuning-panel')).not.toBeVisible();
  });

  test('panel is hidden during print via @media print', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#tuning-panel')).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#tuning-panel')).not.toBeVisible();
    await page.emulateMedia({ media: 'screen' });
    await expect(page.locator('#tuning-panel')).toBeVisible();
  });

  test('dragging the header repositions the panel', async ({ page }) => {
    await boot(page);
    await page.waitForSelector('#tuning-panel');
    const headerBox = await page.locator('#tuning-panel .tune-head').boundingBox();
    const panelBox0 = await page.locator('#tuning-panel').boundingBox();
    // Start drag at left side of header (away from the ✕ close button).
    // Move left (more room in the viewport) and down.
    const sx = headerBox.x + 10;
    const sy = headerBox.y + 5;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx - 50, sy + 60, { steps: 10 });
    await page.mouse.up();
    const panelBox1 = await page.locator('#tuning-panel').boundingBox();
    expect(Math.round(panelBox1.x - panelBox0.x)).toBe(-50);
    expect(Math.round(panelBox1.y - panelBox0.y)).toBe(60);
  });

  test('frequency callout arrow and text size controls are tunable', async ({ page }) => {
    await boot(page);
    await openTuneGroup(page, 'Reference overlays');
    await expect(page.locator('#tune-commChangeArrowStartGapPx-range')).toBeVisible();
    await expect(page.locator('#tune-commChangeArrowWidthPx-range')).toBeVisible();
    await expect(page.locator('#tune-commChangeNameFontPx-range')).toBeVisible();
    await expect(page.locator('#tune-commChangeFreqFontPx-range')).toBeVisible();

    await page.locator('#tune-commChangeArrowStartGapPx-number').fill('12');
    await page.locator('#tune-commChangeArrowWidthPx-number').fill('7');
    await page.locator('#tune-commChangeNameFontPx-number').fill('18');
    await page.locator('#tune-commChangeFreqFontPx-number').fill('20');

    const out = await page.evaluate(() => ({
      startGap: tune('commChangeArrowStartGapPx'),
      arrowWidth: tune('commChangeArrowWidthPx'),
      nameSize: tune('commChangeNameFontPx'),
      freqSize: tune('commChangeFreqFontPx'),
      persisted: Object.keys(localStorage).filter(k => k.indexOf('navaid.tune') === 0),
    }));
    expect(out).toEqual({
      startGap: 12,
      arrowWidth: 7,
      nameSize: 18,
      freqSize: 20,
      persisted: [],
    });
  });
});
