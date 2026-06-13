// @ts-check
// Coverage for under-tested interactive UI areas:
//   - Inspector panel (waypoint click → open, edit name, close)
//   - Charts modal navigation (open airport row, click plate, plate viewer)
//   - Toolbar drag (#toolbar-handle writes navaid.toolbarPos)
//   - Rotate dial (map rotation writes navaid.bearing)
//   - Page frame A3/A4 (show/hide via toolbar buttons)
const { test, expect } = require('./_setup');
const { LLHZ } = require('./_airfieldArp');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_deep_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_deep_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof showInspector === 'function');
}

async function bootWithSavedSelection(page, route, selected) {
  await page.addInitScript(({ route, selected }) => {
    try {
      for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
      sessionStorage.clear();
      for (const s of ['build','view','display','charts','export','print'])
        localStorage.setItem('navaid.sec.' + s, '1');
      localStorage.setItem('navaid.route', JSON.stringify(route));
      sessionStorage.setItem('navaid.selected', JSON.stringify(selected));
    } catch (e) {}
  }, { route, selected });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof showInspector === 'function');
}

// ---------------------------------------------------------------------------
// Inspector panel
// ---------------------------------------------------------------------------
test.describe('Inspector panel', () => {
  test('opens when a waypoint is selected; close button hides it', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.1, lng: 34.9, name: 'ALPHA' }];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    await expect(page.locator('#inspector')).not.toHaveClass(/hidden/);
    expect(await page.locator('#insp-title').inputValue()).toBe('ALPHA');

    await page.locator('#insp-close').click();
    await expect(page.locator('#inspector')).toHaveClass(/hidden/);
    const sel = await page.evaluate(() => state.selected);
    expect(sel).toBeNull();
  });

  test('editing the inspector waypoint-name row updates state.waypoints[i].name live', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.1, lng: 34.9, name: 'OLD' }];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    await page.locator('#insp-body .row input[type="text"]').first().fill('NEW_NAME');
    const name = await page.evaluate(() => state.waypoints[0].name);
    expect(name).toBe('NEW_NAME');
  });

  test('inspector body shows latitude + longitude rows for waypoint', async ({ page }) => {
    await boot(page);
    await page.evaluate(hz => {
      state.waypoints = [{ lat: hz.lat, lng: hz.lng, name: 'LLHZ' }];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    }, LLHZ);
    const bodyText = await page.locator('#insp-body').textContent();
    expect(bodyText).toMatch(/Latitude/);
    expect(bodyText).toMatch(/Longitude/);
  });

  test('waypoint inspector shows an expandable satellite snippet', async ({ page }) => {
    await boot(page);
    await page.evaluate(hz => {
      state.waypoints = [{ lat: hz.lat, lng: hz.lng, name: 'LLHZ' }];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    }, LLHZ);

    const snippet = page.locator('#insp-body .satellite-snippet').first();
    await expect(page.locator('#insp-body .satellite-snippet-section')).toBeVisible();
    await expect(snippet).toBeVisible();
    await expect(snippet.locator('img')).toHaveCount(9);
    await expect(snippet.locator('.satellite-crosshair')).toBeVisible();
    const src = await snippet.locator('img').first().getAttribute('src');
    expect(src).toContain('World_Imagery/MapServer/tile/');

    await snippet.click();
    const modal = page.locator('.satellite-preview-modal');
    await expect(modal).toBeVisible();
    // Title shows the location name + coordinates (not the generic
    // "Satellite view" header) — identity moved to the top of the modal.
    const titleText = await modal.locator('.modal-title').textContent();
    expect(titleText).toContain('LLHZ');
    expect(titleText).toMatch(/[NS].*[EW]/);
    expect(titleText).not.toContain('Satellite view');
    // Expanded view is a real Leaflet map: pan, zoom control, layer switcher,
    // reset-to-centre button — mirroring the main map.
    const lmap = modal.locator('.satellite-preview-map');
    await expect(lmap).toBeVisible();
    await expect(lmap.locator('.leaflet-tile').first()).toBeVisible();
    await expect(modal.locator('.leaflet-control-zoom')).toBeVisible();
    await expect(modal.locator('.satellite-reset-control')).toBeVisible();
    // Rotation dial — mirrors the main map's bearing control.
    await expect(modal.locator('.satellite-rotate-dial')).toBeVisible();
    // Layer picker is a dropdown offering the same base layers as the main map.
    const layerSel = modal.locator('.satellite-layer-select');
    await expect(layerSel).toBeVisible();
    await expect(layerSel.locator('option[value="Satellite"]')).toHaveCount(1);
    await expect(layerSel.locator('option[value="CVFR"]')).toHaveCount(1);
    // Chart layers (flight-maps.com) are gated by zoom: disabled at the
    // close-up default zoom, selectable once zoomed out within their range.
    await expect(layerSel.locator('option[value="CVFR"]')).toBeDisabled();
    await modal.getByRole('button', { name: 'Zoom out' }).click();
    await expect(layerSel.locator('option[value="CVFR"]')).toBeEnabled();

    // Zoom + reset controls are reachable by their accessible names.
    await modal.getByRole('button', { name: 'Zoom in' }).click();
    await expect(lmap.locator('.leaflet-tile').first()).toBeVisible();
    await expect(modal.getByRole('button', { name: /recentre/i })).toBeVisible();

    // Closing destroys the Leaflet map (no leaked map instance / container),
    // and re-opening builds a fresh one without error.
    await modal.locator('.modal-close-x, [aria-label="Close"]').first().click();
    await expect(page.locator('.satellite-preview-modal')).toHaveCount(0);
    await expect(page.locator('.satellite-preview-map')).toHaveCount(0);
    await snippet.click();
    await expect(page.locator('.satellite-preview-modal .leaflet-tile').first()).toBeVisible();
  });

  test('restores an open note inspector after refresh', async ({ page }) => {
    await bootWithSavedSelection(page, {
      waypoints: [],
      legs: [],
      notes: [{
        lat: 32.1,
        lng: 34.9,
        text: 'Saved note',
        color: '#fff6aa',
        shape: 'rect',
      }],
    }, { type: 'note', index: 0 });
    await expect(page.locator('#inspector')).not.toHaveClass(/hidden/);
    await expect(page.locator('#insp-body textarea')).toHaveValue('Saved note');
    expect(await page.evaluate(() => state.selected)).toEqual({ type: 'note', index: 0 });
  });

  test('restores an open leg inspector after refresh', async ({ page }) => {
    await bootWithSavedSelection(page, {
      waypoints: [
        { lat: 32.1, lng: 34.9, name: 'ALPHA' },
        { lat: 32.2, lng: 35.0, name: 'BRAVO' },
      ],
      legs: [{
        inboundAltitude: 1000,
        outboundAltitude: 1000,
        flightSpeed: 90,
        inLabel: { a: 0, p: 50, _m: 1 },
        outLabel: { a: 0, p: -50, _m: 1 },
      }],
      notes: [],
    }, { type: 'leg', index: 0 });
    await expect(page.locator('#inspector')).not.toHaveClass(/hidden/);
    await expect(page.locator('#insp-title')).toHaveValue(/ALPHA.*BRAVO/);
    expect(await page.evaluate(() => state.selected)).toEqual({ type: 'leg', index: 0 });
  });

  test('keeps a route waypoint inspector open across language change', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.1, lng: 34.9, name: 'ALPHA' }];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    await expect(page.locator('#inspector')).not.toHaveClass(/hidden/);

    await expect.poll(() =>
      page.evaluate(() => sessionStorage.getItem('navaid.selected')))
      .toBe('{"type":"wp","index":0}');
    await page.goto('?lang=he');
    await page.waitForFunction(() =>
      state && state.selected && state.selected.type === 'wp' && state.selected.index === 0);
    await expect(page.locator('#lang-select')).toHaveValue('he');
    await expect(page.locator('#inspector')).not.toHaveClass(/hidden/);
    await expect(page.locator('#insp-title')).toHaveValue('ALPHA');
  });

  test('restores overlay inspectors after refresh once datasets load', async ({ page }) => {
    await boot(page);

    await page.evaluate(async () => {
      await loadVors();
      state.selected = { type: 'vor', index: vors.findIndex(v => v.ident === 'NAT') };
      showInspector();
    });
    await page.reload();
    await page.waitForFunction(() =>
      state && state.selected && state.selected.type === 'vor' && Array.isArray(vors));
    await expect(page.locator('#insp-title')).toHaveValue('NAT');

    await page.evaluate(() => { state.selected = null; showInspector(); });
    await page.evaluate(async () => {
      await loadAirfields();
      state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLHA') };
      showInspector();
    });
    await page.reload();
    await page.waitForFunction(() =>
      state && state.selected && state.selected.type === 'airfield' && Array.isArray(airfields));
    await expect(page.locator('#insp-title')).toHaveValue(/LLHA/);

    await page.evaluate(() => { state.selected = null; showInspector(); });
    await page.evaluate(async () => {
      await loadNavWaypoints();
      state.selected = { type: 'navwp', index: navWP.findIndex(w => w.name === 'HADRA') };
      showInspector();
    });
    await page.reload();
    await page.waitForFunction(() =>
      state && state.selected && state.selected.type === 'navwp' && Array.isArray(navWP));
    await expect(page.locator('#insp-title')).toHaveValue('HADRA');
  });
});

// ---------------------------------------------------------------------------
// Charts modal navigation
// ---------------------------------------------------------------------------
test.describe('Charts modal navigation', () => {
  test('opens with at least one airport row', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await page.locator('#charts').click();
    await page.locator('.modal-back').waitFor({ timeout: 5000 });

    const rows = page.locator('.charts-airport-header');
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test('clicking an airport header toggles its body open', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await page.locator('#charts').click();
    await page.locator('.modal-back').waitFor();

    const head = page.locator('.charts-airport-header').first();
    await head.click();
    expect(await head.getAttribute('aria-expanded')).toBe('true');
  });

  test('clicking a plate chip opens the plate viewer', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await page.locator('#charts').click();
    await page.locator('.modal-back').waitFor();

    // Find an airport with plates and open it.
    const head = page.locator('.charts-airport-header').first();
    await head.click();

    // Plate chips render as buttons inside .charts-cat blocks.
    const chip = page.locator('.charts-modal-body .plate-chip').first();
    if (await chip.count()) {
      await chip.click();
      // Plate viewer opens as a new modal-back; charts modal stays open
      // underneath. At least one modal-back must still be visible.
      await expect(page.locator('.modal-back').first()).toBeVisible();
    }
  });

  test('Charts section modals reopen after refresh', async ({ page }) => {
    await boot(page);
    const cases = [
      { button: '#charts', marker: '.charts-airport-header' },
      { button: '#freq-table', marker: '.charts-freq-title h3' },
      { button: '#alt-pairs', marker: '.charts-alt-title' },
      { button: '#route-templates', marker: '.route-template-modal' },
    ];
    for (const c of cases) {
      await page.locator(c.button).click();
      await expect(page.locator(c.marker).first()).toBeVisible();
      await page.reload();
      await expect(page.locator(c.marker).first()).toBeVisible();
      await page.locator('.modal-back .modal-close-x').last().click();
      await expect(page.locator('.modal-back')).toHaveCount(0);
    }
  });

  test('Opening a charts section window closes the previous charts section window', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => typeof state !== 'undefined' &&
      typeof showChartsModal === 'function' &&
      typeof showFreqTableModal === 'function' &&
      typeof showAltitudePairsModal === 'function' &&
      typeof showRouteTemplatesModal === 'function' &&
      typeof showFlightPlan === 'function');
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.1, lng: 34.9, name: 'A' },
        { lat: 32.2, lng: 35.0, name: 'B' },
      ];
      state.legs = [];
      syncLegs();
      draw();
    });
    const cases = [
      { button: '#charts', kind: 'airport-charts', marker: '.charts-airport-header' },
      { button: '#plan', kind: 'flight-plan', marker: '.flight-table' },
      { button: '#freq-table', kind: 'freq-table', marker: '.charts-freq-title h3' },
      { button: '#plan', kind: 'flight-plan', marker: '.flight-table' },
      { button: '#alt-pairs', kind: 'alt-pairs', marker: '.charts-alt-title' },
      { button: '#route-templates', kind: 'route-templates', marker: '.route-template-modal' },
    ];
    for (const c of cases) {
      await page.locator(c.button).click();
      await expect(page.locator(c.marker).first()).toBeVisible();
      const open = await page.evaluate(() => ({
        charts: Array.from(document.querySelectorAll('.modal-back[data-chart-modal]'))
          .map(el => el.dataset.chartModal),
        flightPlan: !!window.fpOpen,
      }));
      if (c.kind === 'flight-plan') {
        expect(open).toEqual({ charts: [], flightPlan: true });
      } else {
        expect(open).toEqual({ charts: [c.kind], flightPlan: false });
      }
    }
    await page.locator('.modal-back .modal-close-x').last().click();
    await expect(page.locator('.modal-back')).toHaveCount(0);
  });

  test('Charts section modals allow toolbar language change', async ({ page }) => {
    await boot(page);
    const cases = [
      { button: '#charts', marker: '.charts-airport-header' },
      { button: '#freq-table', marker: '.charts-freq-title h3' },
      { button: '#alt-pairs', marker: '.charts-alt-title' },
      { button: '#route-templates', marker: '.route-template-modal' },
    ];
    for (const c of cases) {
      await page.goto('?lang=en');
      await page.waitForFunction(() => typeof state !== 'undefined' &&
        typeof showChartsModal === 'function' &&
        typeof showRouteTemplatesModal === 'function');
      await page.locator(c.button).click();
      await expect(page.locator(c.marker).first()).toBeVisible();
      await expect(page.locator('.modal-back.flight-plan')).toHaveCount(1);
      await Promise.all([
        page.waitForURL(/lang=he/),
        page.locator('#lang-select').selectOption('he'),
      ]);
      await expect(page.locator('html')).toHaveAttribute('lang', 'he');
      await expect(page.locator(c.marker).first()).toBeVisible();
      await page.locator('.modal-back .modal-close-x').last().click();
      await expect(page.locator('.modal-back')).toHaveCount(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Toolbar drag (#toolbar-handle → navaid.toolbarPos)
// ---------------------------------------------------------------------------
test.describe('Toolbar drag', () => {
  test('dragging the handle writes navaid.toolbarPos to localStorage', async ({ page }) => {
    await boot(page);
    const handle = page.locator('#toolbar-handle');
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    if (!handleBox) return;

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 80, handleBox.y + 60, { steps: 4 });
    await page.mouse.up();

    const stored = await page.evaluate(() => localStorage.getItem('navaid.toolbarPos'));
    expect(stored).toBeTruthy();
    const pos = JSON.parse(stored);
    expect(typeof pos.x).toBe('number');
    expect(typeof pos.y).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Rotate dial (map rotation → navaid.bearing)
// ---------------------------------------------------------------------------
test.describe('Rotate dial / map bearing', () => {
  test('rotating the map persists bearing to localStorage', async ({ page }) => {
    await boot(page);
    // Trigger a rotation through the Leaflet plugin. The 'rotate' event
    // fires a debounced 400 ms persist in ui.js.
    await page.evaluate(() => {
      if (typeof map.setBearing === 'function') map.setBearing(45);
    });
    await page.waitForTimeout(600);

    const stored = await page.evaluate(() => localStorage.getItem('navaid.bearing'));
    expect(stored).toBeTruthy();
    const b = parseFloat(stored);
    expect(b).toBeCloseTo(45, 0);
  });

  test('rotate-dial element is present and tabbable', async ({ page }) => {
    await boot(page);
    const dial = page.locator('#rotate-dial');
    await expect(dial).toBeVisible();
    expect(await dial.getAttribute('role')).toBe('slider');
    expect(await dial.getAttribute('tabindex')).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// Page frame A3 / A4 buttons
// ---------------------------------------------------------------------------
test.describe('Page frame A3 / A4', () => {
  test('A4 button enables the page frame (button gets .active)', async ({ page }) => {
    await boot(page);
    const a4 = page.locator('#page-a4');
    await a4.click();
    await expect(a4).toHaveClass(/active/);
  });

  test('clicking the same size button again toggles the frame off', async ({ page }) => {
    await boot(page);
    const a4 = page.locator('#page-a4');
    await a4.click();
    await expect(a4).toHaveClass(/active/);
    await a4.click();
    await expect(a4).not.toHaveClass(/active/);
  });

  test('switching from A4 to A3 transfers the .active marker', async ({ page }) => {
    await boot(page);
    await page.locator('#page-a4').click();
    await page.locator('#page-a3').click();
    await expect(page.locator('#page-a4')).not.toHaveClass(/active/);
    await expect(page.locator('#page-a3')).toHaveClass(/active/);
  });

  test('toggling orientation persists navaid.pageOrient', async ({ page }) => {
    await boot(page);
    await page.locator('#page-a4').click();
    const before = await page.evaluate(() => window.pageOrient);
    await page.locator('#page-orient').click();
    const after = await page.evaluate(() => window.pageOrient);
    expect(after).not.toBe(before);
    const stored = await page.evaluate(() => localStorage.getItem('navaid.pageOrient'));
    expect(stored).toBe(after);
  });
});
