// @ts-check
// Issue #413 — the map's viewport (center + zoom + bearing) persists
// across browser reloads via the `navaid.view` localStorage key. Boot
// restores the saved view before the fit-to-route fallback runs.
const { test, expect } = require('./_setup');
const { LLHZ, LLHA } = require('./_airfieldArp');

const ROUTE = {
  waypoints: [
    { lat: LLHZ.lat, lng: LLHZ.lng, name: 'LLHZ' },
    { lat: 32.46472, lng: 34.91222, name: 'HADRA' },
    { lat: LLHA.lat, lng: LLHA.lng, name: 'LLHA' },
  ],
};

// Sentinel-guarded init: clear storage only on the FIRST navigation in a
// given test so subsequent reload()s inherit the persisted state we set
// up. Mirrors the convention in routes.spec.js. Opens every toolbar
// section so direct clicks on buttons inside (e.g. `#fit` in Build) are
// not blocked by the collapsed section.
async function setupCleanInit(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_view_init_v1') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print']) {
          localStorage.setItem('navaid.sec.' + s, '1');
        }
        localStorage.setItem('__test_view_init_v1', '1');
      }
    } catch (e) {}
  });
}

// Boot to a clean app — no route, no saved view. Used by the
// first-time-user tests.
async function bootEmpty(page) {
  await setupCleanInit(page);
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof map !== 'undefined' && typeof fitView === 'function');
}

// Boot + inject the 3-WP fixture above. The injection runs after the app
// has booted, so the route is in memory but the app's automatic boot-time
// fit/restore has already chosen the initial view.
async function bootWithRoute(page) {
  await bootEmpty(page);
  await page.evaluate(route => {
    state.waypoints = route.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
    syncLegs();
    draw();
  }, ROUTE);
}

test.describe('navaid.view — center + zoom persistence', () => {
  test('pan + zoom is restored on reload', async ({ page }) => {
    await bootWithRoute(page);

    // Move to a known view well inside the Israel bbox.
    await page.evaluate(() => {
      map.setView([32.55, 35.20], 12, { animate: false });
    });
    // 300 ms debounce + buffer for moveend to settle and localStorage write.
    await page.waitForTimeout(450);
    await page.waitForFunction(() => {
      try {
        const raw = localStorage.getItem('navaid.view');
        if (!raw) return false;
        const v = JSON.parse(raw);
        return v && v.zoom === 12;
      } catch (e) { return false; }
    });

    await page.reload();
    await page.waitForFunction(() => typeof map !== 'undefined');

    const after = await page.evaluate(() => {
      const c = map.getCenter();
      return { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
    });
    // Leaflet rounds center to the nearest pixel during setView; 1e-4 deg
    // (~11 m) is plenty of headroom while still asserting same-place.
    expect(Math.abs(after.lat - 32.55)).toBeLessThan(2e-4);
    expect(Math.abs(after.lng - 35.20)).toBeLessThan(2e-4);
    expect(after.zoom).toBe(12);
  });

  test('rotate is restored on reload', async ({ page }) => {
    await bootEmpty(page);
    // Set bearing 45° via the rotate-plugin API.
    await page.evaluate(() => {
      map.setBearing(45);
    });
    await page.waitForTimeout(450);            // debounce + write
    await page.waitForFunction(() => {
      try {
        const raw = localStorage.getItem('navaid.view');
        if (!raw) return false;
        const v = JSON.parse(raw);
        // Bearing round-trips through normalisation inside leaflet-rotate;
        // any nonzero value persisted is enough to prove the save fired.
        return v && typeof v.bearing === 'number' && Math.round(v.bearing) === 45;
      } catch (e) { return false; }
    });

    await page.reload();
    await page.waitForFunction(() => typeof map !== 'undefined' && map.getBearing);

    const bearing = await page.evaluate(() => map.getBearing());
    expect(Math.round(bearing)).toBe(45);
  });
});

test.describe('navaid.view — fallback behaviour', () => {
  test('first-time user (clean storage) still gets fit-to-route on a restored route', async ({ page }) => {
    // First boot: inject the route via the live globals (so legs auto-sync
    // and the persisted blob satisfies validateRoute on reload), let it
    // persist, then clear `navaid.view` and reload — the boot path runs
    // through restoreRoute() and lands on the auto-fit branch.
    await bootWithRoute(page);
    await page.waitForTimeout(600);            // let route + view debouncers drain
    await page.evaluate(() => { draw(); });    // force a fresh persist of the route
    await page.waitForFunction(() => {
      try {
        const raw = localStorage.getItem('navaid.route');
        return raw && JSON.parse(raw).waypoints.length === 3;
      } catch (e) { return false; }
    });
    await page.evaluate(() => { localStorage.removeItem('navaid.view'); });

    await page.reload();
    await page.waitForFunction(() => typeof map !== 'undefined' && state.waypoints.length === 3);

    // After boot the map should be framed around the route — center close
    // to the bounding-box midpoint of the fixture.
    const after = await page.evaluate(() => {
      const c = map.getCenter();
      return { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
    });
    const midLat = (ROUTE.waypoints[0].lat + ROUTE.waypoints[ROUTE.waypoints.length - 1].lat) / 2;
    const midLng = (ROUTE.waypoints[0].lng + ROUTE.waypoints[ROUTE.waypoints.length - 1].lng) / 2;
    expect(Math.abs(after.lat - midLat)).toBeLessThan(0.5);
    expect(Math.abs(after.lng - midLng)).toBeLessThan(0.5);
    // fitBounds clamps maxZoom to 11 in fitView() — never above it.
    expect(after.zoom).toBeLessThanOrEqual(11);
  });

  test('Fit-to-route button re-runs the fit and updates navaid.view', async ({ page }) => {
    await bootWithRoute(page);

    // Pretend the user had zoomed elsewhere and the view was saved.
    await page.evaluate(() => {
      map.setView([32.10, 34.85], 13, { animate: false });
    });
    await page.waitForTimeout(450);

    // Now click the Fit button — view should snap to the route bounding box.
    await page.locator('#fit').click();
    // Wait for the debounced save triggered by the resulting moveend.
    await page.waitForTimeout(450);

    const after = await page.evaluate(() => {
      const c = map.getCenter();
      const stored = JSON.parse(localStorage.getItem('navaid.view') || '{}');
      return {
        center: { lat: c.lat, lng: c.lng },
        zoom: map.getZoom(),
        stored,
      };
    });
    // Sanity: zoom clamped per fitView()'s maxZoom: 11.
    expect(after.zoom).toBeLessThanOrEqual(11);
    // The persisted view matches the resulting fit-to-route view.
    expect(Math.abs(after.stored.lat - after.center.lat)).toBeLessThan(1e-4);
    expect(Math.abs(after.stored.lng - after.center.lng)).toBeLessThan(1e-4);
    expect(after.stored.zoom).toBe(after.zoom);
  });

  test('F keyboard shortcut re-runs fit-to-route', async ({ page }) => {
    await bootWithRoute(page);

    // Move somewhere off-route so we can detect the fit.
    await page.evaluate(() => {
      map.setView([32.10, 34.85], 13, { animate: false });
    });
    await page.waitForTimeout(450);

    await page.locator('body').press('f');

    const after = await page.evaluate(() => map.getZoom());
    // fitView() clamps to maxZoom: 11, so a 3-WP route across ~70 km
    // never stays at 13 after F.
    expect(after).toBeLessThanOrEqual(11);
  });

  test('F shortcut is ignored while typing in an input', async ({ page }) => {
    await bootWithRoute(page);
    await page.evaluate(() => {
      map.setView([32.10, 34.85], 13, { animate: false });
    });
    await page.waitForTimeout(450);

    // Open the inspector for a waypoint so the title input is focusable.
    await page.evaluate(() => {
      state.selected = { type: 'wp', index: 0 };
      showInspector();
    });
    await page.locator('#insp-title').focus();
    await page.locator('#insp-title').press('f');

    // Zoom must NOT have changed — typing in the input shouldn't fit.
    const z = await page.evaluate(() => map.getZoom());
    expect(z).toBe(13);
  });
});

test.describe('navaid.view — sanity validation', () => {
  test('out-of-Israel coords are discarded; falls back to default boot view', async ({ page }) => {
    await setupCleanInit(page);
    await page.addInitScript(() => {
      try {
        // Far outside the [28..34, 33..36] sanity bbox — must be rejected.
        localStorage.setItem('navaid.view', JSON.stringify({
          lat: 0, lng: 0, zoom: 10,
        }));
      } catch (e) {}
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof map !== 'undefined');

    const after = await page.evaluate(() => {
      const c = map.getCenter();
      return { lat: c.lat, lng: c.lng };
    });
    // Default boot center is [32.0, 34.9] (core.js). The stale (0,0) view
    // must have been rejected — so we should be near the default.
    expect(Math.abs(after.lat - 32.0)).toBeLessThan(0.5);
    expect(Math.abs(after.lng - 34.9)).toBeLessThan(0.5);
  });

  test('zoom outside [minZoom, maxZoom] is discarded', async ({ page }) => {
    await setupCleanInit(page);
    await page.addInitScript(() => {
      try {
        // map.options.minZoom=8, maxZoom=15 — zoom 22 is out of range.
        localStorage.setItem('navaid.view', JSON.stringify({
          lat: 32.5, lng: 35.0, zoom: 22,
        }));
      } catch (e) {}
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof map !== 'undefined');

    const z = await page.evaluate(() => map.getZoom());
    // Saved zoom rejected → fell back to the L.map() construction default, which is
    // now the gistable landing zoom (defaultViewZoom = 11; z9 drew the chart at 0.13x).
    expect(z).toBe(11);
  });

  test('malformed JSON in navaid.view is discarded gracefully', async ({ page }) => {
    await setupCleanInit(page);
    await page.addInitScript(() => {
      try { localStorage.setItem('navaid.view', '{not json'); } catch (e) {}
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof map !== 'undefined');

    // No crash, no rethrow: app booted and map is interactive.
    const z = await page.evaluate(() => map.getZoom());
    expect(typeof z).toBe('number');
  });
});
