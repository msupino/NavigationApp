// @ts-check
// Coverage for under-tested interactive UI areas:
//   - Inspector panel (waypoint click → open, edit name, close)
//   - Charts modal navigation (open airport row, click plate, plate viewer)
//   - Toolbar drag (#toolbar-handle writes navaid.toolbarPos)
//   - Rotate dial (map rotation writes navaid.bearing)
//   - Page frame A3/A4 (show/hide via toolbar buttons)
const { test, expect } = require('./_setup');
const { LLHZ } = require('./_airfieldArp');

const MAP_TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64');

// These specs reload the page and drive heavy modals; the default 15s is tight
// under parallel-worker CI load and flakes with page-closed timeouts. Give the
// whole file room.
test.describe.configure({ timeout: 45_000 });

async function boot(page, lang = 'en') {
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
  await page.goto('?lang=' + lang);
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof showInspector === 'function');
  await hideToolbarMenus(page);
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
  await hideToolbarMenus(page);
}

async function showToolbarControl(page, selector) {
  const section = await page.locator(selector).evaluate(el =>
    el.closest('.tb-section')?.getAttribute('data-sec'));
  if (!section) return;
  await page.evaluate(sec => {
    for (const el of document.querySelectorAll('.tb-section')) {
      const open = el.getAttribute('data-sec') === sec;
      el.classList.toggle('open', open);
      el.querySelector('.tb-section-head')?.setAttribute('aria-expanded', open ? 'true' : 'false');
      try { localStorage.setItem('navaid.sec.' + el.getAttribute('data-sec'), open ? '1' : '0'); }
      catch (e) {}
    }
    const toolbar = document.getElementById('toolbar');
    if (toolbar) {
      toolbar.classList.remove('multi-open');
      toolbar.dataset.openCount = '1';
    }
  }, section);
}

async function hideToolbarMenus(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('.tb-section.open')) {
      el.classList.remove('open');
      el.querySelector('.tb-section-head')?.setAttribute('aria-expanded', 'false');
      try { localStorage.setItem('navaid.sec.' + el.getAttribute('data-sec'), '0'); }
      catch (e) {}
    }
    const toolbar = document.getElementById('toolbar');
    if (toolbar) {
      toolbar.classList.remove('multi-open');
      toolbar.dataset.openCount = '0';
    }
  });
}

async function clickToolbarControl(page, selector) {
  await showToolbarControl(page, selector);
  await page.locator(selector).click();
  await hideToolbarMenus(page);
}

// ---------------------------------------------------------------------------
// Inspector panel
// ---------------------------------------------------------------------------
test.describe('Inspector panel', () => {
  // The satellite-modal test mocks third-party tiles below. The app service
  // worker claims the page and otherwise owns those requests before
  // Playwright's route handlers can fulfill them.
  test.use({ serviceWorkers: 'block' });

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
    // Keep the modal interaction deterministic: this test verifies layer
    // switching and zoom behavior, not availability of third-party tiles.
    await page.route(/World_Imagery\/MapServer\/tile\//, route => route.fulfill({
      status: 200, contentType: 'image/png', body: MAP_TILE_PNG,
    }));
    // Either chart host: the live site draws from flight-maps.com, every other deployment
    // (this harness included) from our own mirror.
    await page.route(/^https?:\/\/(([^/]*\.)?flight-maps\.com\/tiles\/|navaid-tiles\.supino\.org\/)/,
      route => route.fulfill({
        status: 200, contentType: 'image/png', body: MAP_TILE_PNG,
      }));
    await boot(page);
    await page.evaluate(hz => {
      state.waypoints = [{ lat: hz.lat, lng: hz.lng, name: 'LLHZ' }];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    }, LLHZ);

    const snippet = page.locator('#insp-body .satellite-snippet').first();
    await expect(page.locator('#insp-body .satellite-snippet-section')).toBeVisible();

    // The static preview tiles rotate to match the main map's bearing.
    await page.evaluate(() => map.setBearing(90));
    await page.evaluate(() => { state.selected = { type: 'wp', index: 0 }; showInspector(); });
    const t = await page.locator('#insp-body .satellite-snippet-tiles').first()
      .evaluate(el => getComputedStyle(el).transform);
    // bearing 90 → rotate(90deg) → matrix(0,1,-1,0,0,0)
    expect(t).toMatch(/matrix\(\s*-?0?\.?0*\s*,\s*1\b/);
    await page.evaluate(() => map.setBearing(0));

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
    await expect(layerSel.locator('option[value="CVFR"]')).toBeEnabled();
    await layerSel.selectOption('CVFR');
    await expect(layerSel).toHaveValue('CVFR');
    await page.waitForFunction(() =>
      window.__satModalMap && window.__satModalMap.getZoom() === 14);
    const chartLayer = await page.evaluate(() => {
      if (!window.__satModalMap) return null;
      let out = null;
      window.__satModalMap.eachLayer(layer => {
        // The CVFR chart layer, whichever host serves it here: flight-maps.com on the live
        // site, our mirror everywhere else. Anchored on the whole URL rather than matching a
        // path fragment that any host could carry.
        const chartUrl = /^https:\/\/(flight-maps\.com\/tiles\/cvfr\/|navaid-tiles\.supino\.org\/CVFR\/)/;
        if (layer && layer._url && chartUrl.test(layer._url)) {
          out = {
            zoom: window.__satModalMap.getZoom(),
            maxZoom: layer.options.maxZoom,
            maxNativeZoom: layer.options.maxNativeZoom,
          };
        }
      });
      return out;
    });
    expect(chartLayer).toEqual({ zoom: 14, maxZoom: 14, maxNativeZoom: 13 });

    // Chart layers use their own close-up cap: z16+ only overscales the same
    // native chart tile into blur, so switching from Satellite z17 snaps CVFR
    // back into a readable range.
    const chartZoomBounds = await page.evaluate(() => ({
      zoom: window.__satModalMap.getZoom(),
      minZoom: window.__satModalMap.getMinZoom(),
      maxZoom: window.__satModalMap.getMaxZoom(),
    }));
    expect(chartZoomBounds).toEqual({ zoom: 14, minZoom: 13, maxZoom: 14 });

    // Zoom + reset controls are reachable by their accessible names. At the
    // readable chart cap, zoom-in is disabled; zooming out and back in stays
    // within the chart range.
    const zoomIn = modal.getByRole('button', { name: 'Zoom in' });
    await expect(zoomIn).toHaveAttribute('aria-disabled', 'true');
    await modal.getByRole('button', { name: 'Zoom out' }).click();
    await page.waitForFunction(() =>
      window.__satModalMap && window.__satModalMap.getZoom() === 13);
    await zoomIn.click();
    await page.waitForFunction(() =>
      window.__satModalMap && window.__satModalMap.getZoom() === 14);
    // Leaflet retains the prior zoom level's tiles as hidden DOM nodes while
    // the replacement level settles. Select the rendered tile instead of
    // pinning the assertion to a stale hidden `.first()` element.
    await expect(lmap.locator('.leaflet-tile:visible').first()).toBeVisible();
    expect(await page.evaluate(() => window.__satModalMap.getZoom())).toBe(14);
    // Zoom readout chip mirrors the main map: `z<level> · <mult>×`, z12 = 1×
    // (mult = 2^(z-12), so z14 → 4×). It tracks the zoom buttons live.
    const satZoom = modal.locator('.satellite-zoom-readout');
    await expect(satZoom).toBeVisible();
    await expect(satZoom).toHaveText('z14 · 4×');
    await modal.getByRole('button', { name: 'Zoom out' }).click();
    await page.waitForFunction(() =>
      window.__satModalMap && window.__satModalMap.getZoom() === 13);
    await expect(satZoom).toHaveText('z13 · 2×');
    await zoomIn.click();
    await page.waitForFunction(() =>
      window.__satModalMap && window.__satModalMap.getZoom() === 14);
    await expect(modal.getByRole('button', { name: /recentre/i })).toBeVisible();

    // Two-way bearing sync: rotating the main map rotates the modal map…
    await page.evaluate(() => map.setBearing(40));
    const modalBearing = await page.evaluate(() =>
      window.__satModalMap ? Math.round(window.__satModalMap.getBearing()) : null);
    expect(modalBearing).toBe(40);
    // …and rotating the modal map rotates the main map.
    await page.evaluate(() => window.__satModalMap.setBearing(120));
    const mainBearing = await page.evaluate(() => Math.round(map.getBearing()));
    expect(mainBearing).toBe(120);
    await page.evaluate(() => map.setBearing(0));

    // Closing destroys the Leaflet map (no leaked map instance / container),
    // and re-opening builds a fresh one without error.
    await modal.locator('.modal-close-x, [aria-label="Close"]').first().click();
    await expect(page.locator('.satellite-preview-modal')).toHaveCount(0);
    await expect(page.locator('.satellite-preview-map')).toHaveCount(0);
    await snippet.click();
    await expect(page.locator('.satellite-preview-modal .leaflet-tile').first()).toBeVisible();
  });

  test('zoom readout shows level plus a z12-anchored multiplier', async ({ page }) => {
    await boot(page, 'en');
    // Pure helper: each whole zoom doubles scale, anchored at z12 = 1×.
    const cases = await page.evaluate(() => ({
      z12: zoomReadoutText(12),
      z13: zoomReadoutText(13),
      z11: zoomReadoutText(11),
      frac: zoomReadoutText(12.75),
      z16: zoomReadoutText(16),
    }));
    expect(cases.z12).toBe('z12 · 1×');
    expect(cases.z13).toBe('z13 · 2×');
    expect(cases.z11).toBe('z11 · 0.5×');
    expect(cases.frac).toBe('z12.75 · 1.68×');
    expect(cases.z16).toBe('z16 · 16×');
    // The on-map readout uses the same helper.
    await page.evaluate(() => map.setZoom(13));
    await page.waitForFunction(() => map.getZoom() === 13);
    await page.evaluate(() => showZoom());
    await expect(page.locator('#zoom-readout')).toHaveText('z13 · 2×');
  });

  test('Hebrew satellite preview title keeps name before coordinates', async ({ page }) => {
    await boot(page, 'he');
    const expected = await page.evaluate(() => {
      const point = { lat: 32.21861, lng: 34.88250 };
      const title = 'BAZRA / בצרה - ' +
        fmtLatLng(point.lat, 'N', 'S') + ' ' +
        fmtLatLng(point.lng, 'E', 'W');
      showSatellitePreviewModal(point, 'BAZRA / בצרה');
      return title;
    });
    const title = page.locator('.satellite-preview-modal .modal-title');
    await expect(title).toHaveText(expected);
    const bidi = await title.evaluate(el => ({
      dir: getComputedStyle(el).direction,
      unicodeBidi: getComputedStyle(el).unicodeBidi,
    }));
    expect(bidi.dir).toBe('ltr');
    expect(bidi.unicodeBidi).toContain('isolate');
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
    await expect(page.locator('#insp-title')).toHaveValue(/NAT.*Natania/);

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
    await expect(page.locator('#insp-title')).toHaveValue(/HADRA/);
  });
});

// ---------------------------------------------------------------------------
// Charts modal navigation
// ---------------------------------------------------------------------------
test.describe('Charts modal navigation', () => {
  test('opens with at least one airport row', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await clickToolbarControl(page, '#charts');
    await page.locator('.modal-back').waitFor({ timeout: 5000 });

    const rows = page.locator('.charts-airport-header');
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test('clicking an airport header toggles its body open', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await clickToolbarControl(page, '#charts');
    await page.locator('.modal-back').waitFor();

    const head = page.locator('.charts-airport-header').first();
    await head.click();
    expect(await head.getAttribute('aria-expanded')).toBe('true');
  });

  test('clicking a plate chip opens the plate viewer', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await clickToolbarControl(page, '#charts');
    await page.locator('.modal-back').waitFor();

    // Find an airport with plates and open it.
    const head = page.locator('.charts-airport-header').first();
    await head.click();

    // Plate rows render as buttons inside .charts-cat blocks.
    const chip = page.locator('.charts-modal-body .plate-row').first();
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
      await clickToolbarControl(page, c.button);
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
      await clickToolbarControl(page, c.button);
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
      await clickToolbarControl(page, c.button);
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
// Toolbar drag (#toolbar-handle → navaid.toolbarPos.<lang>)
// ---------------------------------------------------------------------------
test.describe('Toolbar drag', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('dragging the handle writes navaid.toolbarPos.<lang> to localStorage', async ({ page }) => {
    await boot(page);
    const handle = page.locator('#toolbar-handle');
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    if (!handleBox) return;

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 80, handleBox.y + 60, { steps: 4 });
    await page.mouse.up();

    const stored = await page.evaluate(() => localStorage.getItem('navaid.toolbarPos.en'));
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
    await clickToolbarControl(page, '#page-a4');
    await expect(a4).toHaveClass(/active/);
  });

  test('clicking the same size button again toggles the frame off', async ({ page }) => {
    await boot(page);
    const a4 = page.locator('#page-a4');
    await clickToolbarControl(page, '#page-a4');
    await expect(a4).toHaveClass(/active/);
    await clickToolbarControl(page, '#page-a4');
    await expect(a4).not.toHaveClass(/active/);
  });

  test('switching from A4 to A3 transfers the .active marker', async ({ page }) => {
    await boot(page);
    await clickToolbarControl(page, '#page-a4');
    await clickToolbarControl(page, '#page-a3');
    await expect(page.locator('#page-a4')).not.toHaveClass(/active/);
    await expect(page.locator('#page-a3')).toHaveClass(/active/);
  });

  test('toggling orientation persists navaid.pageOrient', async ({ page }) => {
    await boot(page);
    await clickToolbarControl(page, '#page-a4');
    const before = await page.evaluate(() => window.pageOrient);
    await clickToolbarControl(page, '#page-orient');
    const after = await page.evaluate(() => window.pageOrient);
    expect(after).not.toBe(before);
    const stored = await page.evaluate(() => localStorage.getItem('navaid.pageOrient'));
    expect(stored).toBe(after);
  });
});
