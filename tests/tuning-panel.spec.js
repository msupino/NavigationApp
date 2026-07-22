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
    // First-time default is Hebrew (no stored/param lang).
    expect(params.get('lang')).toBe('he');
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
    await openTuneGroup(page, 'Route line');
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
    await openTuneGroup(page, 'Frequency changes');
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

  test('canvas color controls drive rendered drawing colors', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => {
      const colors = {
        labelFillColor: '#010203',
        legKiteFillColor: '#112233',
        returnKiteFillColor: '#445566',
        cumKiteFillColor: '#778899',
        returnCumKiteFillColor: '#aabbcc',
        distanceBadgeFillColor: '#123456',
        waypointFillColor: '#654321',
        noteDefaultFillColor: '#121212',
        windArrowColor: '#336699',
        windArrowHaloColor: '#abcdef',
        windTextHaloColor: '#fedcba',
        liveAircraftFillColor: '#cc1122',
        liveAircraftOutlineColor: '#eeeeee',
        commChangeRingColor: '#990000',
        profileBgColor: '#001122',
        profileGridColor: '#112244',
        profileAxisColor: '#223344',
        profileGroundColor: '#334455',
        profileTextColor: '#445566',
        profileNmTextColor: '#556677',
        profileTimeTextColor: '#667788',
        profileAreaColor: '#778899',
        profileLineColor: '#8899aa',
        profileTocColor: '#00aa33',
        profileTodColor: '#bb6600',
        profileMarkerHaloColor: '#ffffff',
        planCardBgColor: '#fafafa',
        planCardHeaderBgColor: '#111111',
        planCardTotalBgColor: '#222222',
        planCardStripeBgColor: '#333333',
        planCardGridColor: '#444444',
        planCardTextColor: '#555555',
        planCardGripColor: '#666666',
        planCardGripLineColor: '#777777',
        pageFrameScrimColor: '#8899aa',
        sigmetIceColor: '#0088cc',
      };
      for (const [key, color] of Object.entries(colors)) setTune(key, color);
      // Pin both opacity sources so every captured fill has a known alpha,
      // independent of the shipped defaults: waypoint labels use yellowAlpha,
      // kites + notes use tune('kiteNoteAlpha').
      window.yellowAlpha = 0.8;
      setTune('kiteNoteAlpha', 0.8);

      const fills = [];
      const strokes = [];
      const fillDesc = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'fillStyle');
      const strokeDesc = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'strokeStyle');
      Object.defineProperty(octx, 'fillStyle', {
        configurable: true,
        get() { return fillDesc.get.call(this); },
        set(value) {
          fills.push(String(value));
          fillDesc.set.call(this, value);
        },
      });
      Object.defineProperty(octx, 'strokeStyle', {
        configurable: true,
        get() { return strokeDesc.get.call(this); },
        set(value) {
          strokes.push(String(value));
          strokeDesc.set.call(this, value);
        },
      });

      const oldRouteProfile = routeProfile;
      const oldWaypoints = state.waypoints.slice();
      const oldLegs = state.legs.slice();
      const oldNotes = state.notes.slice();
      const oldSelected = state.selected;
      const oldNavWP = navWP;
      const oldCommChangeMap = commChangeMap;
      const oldShowCommChange = showCommChange;
      const oldSimOn = simOn;
      const oldSimAircraft = simAircraft;
      const oldPageSize = pageSize;
      const oldPageOrient = pageOrient;
      const oldPageOffset = pageOffset;
      const oldPlanCard = planCard;
      const oldPlanCardRect = planCardRect;

      try {
        yellowAlpha = 0.8;
        state.waypoints = [
          { lat: 32.1, lng: 34.8, name: 'ALFA' },
          { lat: 32.2, lng: 34.9, name: 'BRAVO' },
          { lat: 32.3, lng: 35.0, name: 'CHARLIE' },
        ];
        state.legs = [];
        state.notes = [{ lat: 32.12, lng: 34.82, text: 'Plain', shape: 'rect' }];
        state.selected = null;
        syncLegs();
        state.legs[0].inboundAltitude = 2500;
        state.legs[0].outboundAltitude = 2500;
        state.legs[0].flightSpeed = 90;
        state.legs[0].outboundSpeed = 90;
        state.legs[1].inboundAltitude = 3000;
        state.legs[1].outboundAltitude = 3000;
        state.legs[1].flightSpeed = 95;
        state.legs[1].outboundSpeed = 95;

        drawLegArrow(80, 70, 0, '123', '0:08', '2500',
          tune('inkColor'), tintFill(tune('legKiteFillColor')), false, 1);
        drawLegArrow(80, 130, 0, '303', '0:08', '2500',
          tune('inkColor'), tintFill(tune('returnKiteFillColor')), false, 1);
        drawCumTimeArrow(170, 70, 0, '0:08',
          tune('inkColor'), tintFill(tune('cumKiteFillColor')), 1);
        drawCumTimeArrow(170, 130, 0, '0:08',
          tune('inkColor'), tintFill(tune('returnCumKiteFillColor')), 1);
        drawDistanceBadge(250, 70, 4.2);
        drawWaypoints();
        drawNotes();
        drawWindArrow(250, 130, { lat: 32.12, lng: 34.82 }, { dir: 270, speed: 18 }, false);

        simOn = true;
        simAircraft = { lat: 32.12, lng: 34.82, hdg: 90 };
        drawOwnShip(simAircraft, simAircraft.hdg);

        navWP = [{ lat: 32.12, lng: 34.82, name: 'TEST' }];
        commChangeMap = { TEST: { commChange: true } };
        showCommChange = true;
        drawCommChangeRings();

        routeProfile = () => ({
          totalDist: 20,
          totalTimeH: 0.25,
          legs: [{ dist: 20 }],
          pts: [
            { d: 0, alt: 0 },
            { d: 10, alt: 3000 },
            { d: 20, alt: 0 },
          ],
          tocs: [{ leg: 0, frac: 0.4, alt: 3000 }],
          tods: [{ leg: 0, frac: 0.7, alt: 3000 }],
          wpCum: [0, 20],
          wpTime: [0, 0.25],
        });
        drawVerticalProfile(octx, 20, 220, 260, 110);
        drawProfileMarkers();

        drawFlightPlanTable(octx, 20, 350, 480, 80, 'tl');
        planCard = { x: 20, y: 450, scale: 1 };
        drawPlanCard();
        planCard = null;
        planCardRect = null;

        pageSize = 'A4';
        pageOrient = 'portrait';
        pageOffset = { x: 0, y: 0 };
        drawPageFrame();
      } finally {
        delete octx.fillStyle;
        delete octx.strokeStyle;
        routeProfile = oldRouteProfile;
        state.waypoints = oldWaypoints;
        state.legs = oldLegs;
        state.notes = oldNotes;
        state.selected = oldSelected;
        navWP = oldNavWP;
        commChangeMap = oldCommChangeMap;
        showCommChange = oldShowCommChange;
        simOn = oldSimOn;
        simAircraft = oldSimAircraft;
        pageSize = oldPageSize;
        pageOrient = oldPageOrient;
        pageOffset = oldPageOffset;
        planCard = oldPlanCard;
        planCardRect = oldPlanCardRect;
      }

      return {
        fills,
        strokes,
        sigmetIce: sigmetHazardColor('ICE'),
        tintFallback: tintFill('#zzzzzz'),
        persisted: Object.keys(localStorage).filter(k => k.indexOf('navaid.tune') === 0),
      };
    });

    expect(out.fills).toContain('rgba(17,34,51,0.8)');
    expect(out.fills).toContain('rgba(68,85,102,0.8)');
    expect(out.fills).toContain('rgba(119,136,153,0.8)');
    expect(out.fills).toContain('rgba(170,187,204,0.8)');
    expect(out.fills).toContain('rgba(18,52,86,0.8)');
    expect(out.fills).toContain('rgba(101,67,33,0.8)');
    expect(out.fills).toContain('rgba(18,18,18,0.8)');
    expect(out.fills).toContain('#336699');
    expect(out.fills).toContain('#cc1122');
    expect(out.fills).toContain('#001122');
    expect(out.fills).toContain('rgba(119, 136, 153, 0.2)');
    expect(out.fills).toContain('#00aa33');
    expect(out.fills).toContain('#bb6600');
    expect(out.fills).toContain('#fafafa');
    expect(out.fills).toContain('#111111');
    expect(out.fills).toContain('#222222');
    expect(out.fills).toContain('#333333');
    expect(out.fills).toContain('#555555');
    expect(out.fills).toContain('#666666');
    expect(out.fills).toContain('rgba(136, 153, 170, 0.4)');
    expect(out.strokes).toContain('rgba(171, 205, 239, 0.85)');
    expect(out.strokes).toContain('rgba(254, 220, 186, 0.9)');
    expect(out.strokes).toContain('rgba(238, 238, 238, 0.9)');
    expect(out.strokes).toContain('#990000');
    expect(out.strokes).toContain('#334455');
    expect(out.strokes).toContain('#8899aa');
    expect(out.strokes).toContain('#444444');
    expect(out.strokes).toContain('#777777');
    expect(out.sigmetIce).toBe('#0088cc');
    expect(out.tintFallback).toBe('rgba(255,246,170,0.8)');
    expect(out.persisted).toEqual([]);
  });

  test('chrome layout controls drive the inspector and Zulu clock CSS', async ({ page }) => {
    await boot(page);
    await openTuneGroup(page, 'Chrome layout');
    await page.locator('#tune-inspectorDefaultTopPx-number').fill('110');
    await page.locator('#tune-inspectorBottomGapPx-number').fill('20');
    await page.locator('#tune-zuluClockMinWidthPx-number').fill('120');
    await page.locator('#tune-zuluClockPadYPx-number').fill('7');
    await page.locator('#tune-zuluClockPadXPx-number').fill('13');
    await page.locator('#tune-zuluClockMarginTopPx-number').fill('16');
    await page.locator('#tune-zuluClockMarginRightPx-number').fill('18');
    await page.locator('#tune-zuluClockFontPx-number').fill('16');
    await page.locator('#tune-zuluClockFontWeight-number').fill('600');
    await page.locator('#tune-zuluClockLineHeight-number').fill('1.4');
    await page.locator('#tune-zuluClockTextColor-text').fill('#ffeeaa');
    await page.locator('#tune-zuluClockBgColor-text').fill('#224466');
    await page.locator('#tune-zuluClockBgAlpha-number').fill('0.5');
    await page.locator('#tune-zuluClockBorderColor-text').fill('#778899');
    await page.locator('#tune-zuluClockBorderWidthPx-number').fill('3');
    await page.locator('#tune-zuluClockBorderRadiusPx-number').fill('9');
    await page.locator('#tune-zuluClockShadowYPx-number').fill('4');
    await page.locator('#tune-zuluClockShadowBlurPx-number').fill('14');
    await page.locator('#tune-zuluClockShadowAlpha-number').fill('0.8');

    const out = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18, lng: 34.81, name: 'BAZRA' }];
      state.selected = { type: 'wp', index: 0 };
      showInspector();
      const root = getComputedStyle(document.documentElement);
      const clock = getComputedStyle(document.getElementById('zulu-clock'));
      const inspector = getComputedStyle(document.getElementById('inspector'));
      const rootVar = name => root.getPropertyValue(name).trim();
      return {
        tuneValues: {
          inspectorDefaultTopPx: tune('inspectorDefaultTopPx'),
          inspectorBottomGapPx: tune('inspectorBottomGapPx'),
          zuluClockMinWidthPx: tune('zuluClockMinWidthPx'),
          zuluClockPadYPx: tune('zuluClockPadYPx'),
          zuluClockPadXPx: tune('zuluClockPadXPx'),
          zuluClockMarginTopPx: tune('zuluClockMarginTopPx'),
          zuluClockMarginRightPx: tune('zuluClockMarginRightPx'),
          zuluClockFontPx: tune('zuluClockFontPx'),
          zuluClockFontWeight: tune('zuluClockFontWeight'),
          zuluClockLineHeight: tune('zuluClockLineHeight'),
          zuluClockTextColor: tune('zuluClockTextColor'),
          zuluClockBgColor: tune('zuluClockBgColor'),
          zuluClockBgAlpha: tune('zuluClockBgAlpha'),
          zuluClockBorderColor: tune('zuluClockBorderColor'),
          zuluClockBorderWidthPx: tune('zuluClockBorderWidthPx'),
          zuluClockBorderRadiusPx: tune('zuluClockBorderRadiusPx'),
          zuluClockShadowYPx: tune('zuluClockShadowYPx'),
          zuluClockShadowBlurPx: tune('zuluClockShadowBlurPx'),
          zuluClockShadowAlpha: tune('zuluClockShadowAlpha'),
        },
        vars: {
          inspectorTop: rootVar('--navaid-inspector-default-top'),
          inspectorMaxHeightOffset: rootVar('--navaid-inspector-max-height-offset'),
          bg: rootVar('--navaid-zulu-clock-bg'),
          border: rootVar('--navaid-zulu-clock-border'),
          shadow: rootVar('--navaid-zulu-clock-shadow'),
        },
        styles: {
          inspectorTop: inspector.top,
          minWidth: clock.minWidth,
          paddingTop: clock.paddingTop,
          paddingRight: clock.paddingRight,
          marginTop: clock.marginTop,
          marginRight: clock.marginRight,
          fontSize: clock.fontSize,
          fontWeight: clock.fontWeight,
          color: clock.color,
          backgroundColor: clock.backgroundColor,
          borderTopWidth: clock.borderTopWidth,
          borderTopColor: clock.borderTopColor,
          borderTopLeftRadius: clock.borderTopLeftRadius,
        },
        persisted: Object.keys(localStorage).filter(k => k.indexOf('navaid.tune') === 0),
      };
    });

    expect(out.tuneValues).toEqual({
      inspectorDefaultTopPx: 110,
      inspectorBottomGapPx: 20,
      zuluClockMinWidthPx: 120,
      zuluClockPadYPx: 7,
      zuluClockPadXPx: 13,
      zuluClockMarginTopPx: 16,
      zuluClockMarginRightPx: 18,
      zuluClockFontPx: 16,
      zuluClockFontWeight: 600,
      zuluClockLineHeight: 1.4,
      zuluClockTextColor: '#ffeeaa',
      zuluClockBgColor: '#224466',
      zuluClockBgAlpha: 0.5,
      zuluClockBorderColor: '#778899',
      zuluClockBorderWidthPx: 3,
      zuluClockBorderRadiusPx: 9,
      zuluClockShadowYPx: 4,
      zuluClockShadowBlurPx: 14,
      zuluClockShadowAlpha: 0.8,
    });
    expect(out.vars).toEqual({
      inspectorTop: '110px',
      inspectorMaxHeightOffset: '130px',
      bg: 'rgba(34, 68, 102, 0.5)',
      border: '3px solid #778899',
      shadow: '0 4px 14px rgba(0, 0, 0, 0.8)',
    });
    expect(out.styles.inspectorTop).toBe('110px');
    expect(out.styles.minWidth).toBe('120px');
    expect(out.styles.paddingTop).toBe('7px');
    expect(out.styles.paddingRight).toBe('13px');
    expect(out.styles.marginTop).toBe('16px');
    expect(out.styles.marginRight).toBe('18px');
    expect(out.styles.fontSize).toBe('16px');
    expect(out.styles.fontWeight).toBe('600');
    expect(out.styles.color).toBe('rgb(255, 238, 170)');
    expect(out.styles.backgroundColor).toBe('rgba(34, 68, 102, 0.5)');
    expect(out.styles.borderTopWidth).toBe('3px');
    expect(out.styles.borderTopColor).toBe('rgb(119, 136, 153)');
    expect(out.styles.borderTopLeftRadius).toBe('9px');
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
    // Downward drag follows the pointer up to the viewport clamp. As tuning
    // groups are added the panel can be tall enough that the clamp trims most
    // of the requested 60px drag, so assert against the computed clamp.
    const dy = Math.round(panelBox1.y - panelBox0.y);
    const viewportH = await page.evaluate(() => window.innerHeight);
    const maxDown = Math.max(0, Math.round(viewportH - panelBox0.height - panelBox0.y));
    const expectedDy = Math.min(60, maxDown);
    expect(dy).toBeGreaterThan(0);
    expect(dy).toBeLessThanOrEqual(expectedDy);
  });

  test('frequency callout arrow and text size controls are tunable', async ({ page }) => {
    await boot(page);
    await openTuneGroup(page, 'Frequency changes');
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
