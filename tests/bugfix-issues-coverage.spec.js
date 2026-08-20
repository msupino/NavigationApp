// @ts-check
// Regression coverage for closed bug issues that previously lacked a test.
// Each suite asserts the user-visible symptom is gone, not the implementation.
//   #224 — Fit-to-screen zooms too tight when waypoints are close
//   #226 — Charts modal: a11y keyboard nav, RTL indent, drag-clamp to viewport
//   #229 — Modal backdrop scrolls out of viewport
const { test, expect } = require('./_setup');
const { LLHZ, LLHA, LLBG } = require('./_airfieldArp');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_ic_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_ic_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof fitView === 'function');
}

// ---------------------------------------------------------------------------
// #224: fit-to-screen must not zoom past a useful CVFR scale for close points.
// ---------------------------------------------------------------------------
test.describe('#224 — fit-to-screen maxZoom cap', () => {
  test('two waypoints ~1 NM apart: fitView caps zoom at 11', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      // Two points ~1 NM apart near LLHZ — without the cap, fitBounds would
      // snap to zoom 14+ and lose surrounding airspace context.
      state.waypoints = [
        { lat: 32.18000, lng: 34.83000, name: 'A' },
        { lat: 32.19500, lng: 34.84500, name: 'B' },
      ];
      syncLegs(); draw(); fitView();
    });
    const zoom = await page.evaluate(() => map.getZoom());
    expect(zoom).toBeLessThanOrEqual(11);
  });

  test('two waypoints ~45 NM apart (LLHZ→LLHA) still fit normally', async ({ page }) => {
    await boot(page);
    await page.evaluate(([hz, ha]) => {
      state.waypoints = [
        { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
        { lat: ha.lat, lng: ha.lng, name: 'LLHA' },
      ];
      syncLegs(); draw(); fitView();
    }, [LLHZ, LLHA]);
    const zoom = await page.evaluate(() => map.getZoom());
    // The wide route should still fit — cap doesn't force it to zoom 11.
    expect(zoom).toBeLessThanOrEqual(11);
    expect(zoom).toBeGreaterThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// #226: charts modal a11y, RTL indent, drag-clamp regressions.
// ---------------------------------------------------------------------------
test.describe('#226 — charts modal regressions', () => {
  // The accordion these two were written for is gone: a field is a real <button> that opens
  // its own screen, so it is keyboard-reachable by being what it is, and there is nothing to
  // expand.
  test('a charts field tile is a real button, reachable from the keyboard', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await page.locator('#charts').click();
    await page.locator('.modal-back').waitFor({ timeout: 5000 });

    const head = page.locator('.charts-field').first();
    expect(await head.evaluate(el => el.tagName)).toBe('BUTTON');
    expect(await head.evaluate(el => el.disabled)).toBe(false);
  });

  test('Enter on a field tile opens that field', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await page.locator('#charts').click();
    await page.locator('.modal-back').waitFor();

    await page.locator('.charts-field').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.charts-airport[data-icao]')).toBeVisible();
  });

  test('charts body uses padding-inline-start, not physical padding-left', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await page.locator('#charts').click();
    await page.locator('.modal-back').waitFor();

    // CSS source must declare padding-inline-start (RTL-aware) somewhere
    // on .charts-airport-body. Fetching the actual linked stylesheet keeps
    // the assertion valid for root, staging, and /pr/NNN/ preview paths.
    const hasInlineStart = await page.evaluate(async () => {
      const href = document.querySelector('link[href*="app/style.css"]')?.href
        || new URL('app/style.css', document.baseURI).href;
      const css = await fetch(href).then(r => r.text());
      const m = css.match(/\.charts-airport-body\s*\{[^}]*\}/);
      return m ? /padding-inline-start/.test(m[0]) : false;
    });
    expect(hasInlineStart).toBe(true);
  });

  test('charts modal title bar cannot be dragged off the top of the viewport', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await page.locator('#charts').click();
    const modal = page.locator('.modal-back .modal.wide');
    await modal.waitFor();

    const titleBar = modal.locator('.modal-title');
    await titleBar.hover();
    await page.mouse.down();
    await page.mouse.move(50, -500, { steps: 5 });   // try to drag well above top
    await page.mouse.up();

    const box = await modal.boundingBox();
    expect(box).not.toBeNull();
    if (box) expect(box.y).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// #229: .modal-back uses position: fixed so it stays in the viewport when
// the page is scrolled.
// ---------------------------------------------------------------------------
test.describe('#229 — modal backdrop position: fixed', () => {
  test('.modal-back computes to position: fixed', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      // syncLegs requires at least 2 waypoints for the flight-plan modal.
      state.waypoints = [
        { lat: 32.0, lng: 34.9, name: 'A' },
        { lat: 32.5, lng: 35.0, name: 'B' },
      ];
      syncLegs(); draw();
    });
    await page.locator('#plan').click();
    await page.locator('.modal-back').waitFor();
    const pos = await page.locator('.modal-back').evaluate(el => getComputedStyle(el).position);
    expect(pos).toBe('fixed');
  });
});

// ---------------------------------------------------------------------------
// #340: Dragging an auto-snapped airfield/nav-waypoint waypoint with both
// overlays off clears the auto-snapped name so it becomes a plain waypoint.
// ---------------------------------------------------------------------------
test.describe('#340 — applyNavSnap clears auto-snapped name when overlays off', () => {
  test('airfield-snapped waypoint: both overlays off → name cleared on drag', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await page.evaluate(bg => {
      state.waypoints = [{ lat: bg.lat, lng: bg.lng, name: 'LLBG' }];
      syncLegs(); draw();
    }, LLBG);
    await page.evaluate(() => {
      showAirfields = false;
      showNavWP = false;
      const wp = state.waypoints[0];
      const target = L.latLng(33.0, 36.0);
      const r = applyNavSnap(target, wp.name);
      wp.lat = r5(r.lat); wp.lng = r5(r.lng); wp.name = r.name;
      draw();
    });
    const name = await page.evaluate(() => state.waypoints[0].name);
    expect(name).toBe('');
  });

  test('nav-waypoint-snapped waypoint: both overlays off → name cleared on drag', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => loadNavWaypoints());
    await page.waitForFunction(() => Array.isArray(window.navWP) && window.navWP.length > 0);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.918611, lng: 35.096389, name: 'AAKKO' }];
      syncLegs(); draw();
    });
    await page.evaluate(() => {
      showAirfields = false;
      showNavWP = false;
      const wp = state.waypoints[0];
      const target = L.latLng(33.0, 36.0);
      const r = applyNavSnap(target, wp.name);
      wp.lat = r5(r.lat); wp.lng = r5(r.lng); wp.name = r.name;
      draw();
    });
    const name = await page.evaluate(() => state.waypoints[0].name);
    expect(name).toBe('');
  });

  test('user-typed name (not auto-snapped): both overlays off → name preserved', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'MYFIELD' }];
      syncLegs(); draw();
    });
    await page.evaluate(() => {
      showAirfields = false;
      showNavWP = false;
      const wp = state.waypoints[0];
      const target = L.latLng(33.0, 36.0);
      const r = applyNavSnap(target, wp.name);
      wp.lat = r5(r.lat); wp.lng = r5(r.lng); wp.name = r.name;
      draw();
    });
    const name = await page.evaluate(() => state.waypoints[0].name);
    expect(name).toBe('MYFIELD');
  });

  test('sequence-style label WP 1: both overlays off → name cleared on drag', async ({ page }) => {
    await boot(page);
    await page.evaluate(bg => {
      state.waypoints = [{ lat: bg.lat, lng: bg.lng, name: 'WP 1' }];
      syncLegs(); draw();
    }, LLBG);
    await page.evaluate(() => {
      showAirfields = false;
      showNavWP = false;
      const wp = state.waypoints[0];
      const target = L.latLng(33.0, 36.0);
      const r = applyNavSnap(target, wp.name);
      wp.lat = r5(r.lat); wp.lng = r5(r.lng); wp.name = r.name;
      draw();
    });
    const name = await page.evaluate(() => state.waypoints[0].name);
    expect(name).toBe('');
  });

  test('sequence-style label at airfield: showAirfields on → applyNavSnap adopts ICAO', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await page.evaluate(bg => {
      state.waypoints = [{ lat: bg.lat, lng: bg.lng, name: 'WP1' }];
      syncLegs(); draw();
    }, LLBG);
    await page.evaluate(() => {
      showAirfields = true;
      showNavWP = false;
      const wp = state.waypoints[0];
      const r = applyNavSnap(L.latLng(wp.lat, wp.lng), wp.name);
      wp.lat = r5(r.lat); wp.lng = r5(r.lng); wp.name = r.name;
      draw();
    });
    const name = await page.evaluate(() => state.waypoints[0].name);
    expect(name).toBe('LLBG');
  });

  test('sequence-shaped stored name WP6: inspector normalizes storage and shows sequence title', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.0, lng: 34.9, name: 'A' },
        { lat: 32.1, lng: 35.0, name: 'B' },
        { lat: 32.2, lng: 35.1, name: 'C' },
        { lat: 32.3, lng: 35.2, name: 'D' },
        { lat: 32.4, lng: 35.3, name: 'E' },
        { lat: 32.5, lng: 35.4, name: 'WP6' },
      ];
      syncLegs(); draw();
      state.selected = { type: 'wp', index: 5 };
      showInspector();
    });
    const val = await page.locator('#insp-title').inputValue();
    const stored = await page.evaluate(() => state.waypoints[5].name);
    expect(val).toBe('WP 6');
    expect(stored).toBe('');
  });

  test('airfield-snapped waypoint: showAirfields off, showNavWP on, far from nav-WP → name cleared', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await page.evaluate(() => loadNavWaypoints());
    await page.waitForFunction(() => Array.isArray(window.navWP) && window.navWP.length > 0);
    await page.evaluate(bg => {
      state.waypoints = [{ lat: bg.lat, lng: bg.lng, name: 'LLBG' }];
      syncLegs(); draw();
    }, LLBG);
    await page.evaluate(() => {
      showAirfields = false;
      showNavWP = true;
      const wp = state.waypoints[0];
      const target = L.latLng(33.0, 36.0);
      const r = applyNavSnap(target, wp.name);
      wp.lat = r5(r.lat); wp.lng = r5(r.lng); wp.name = r.name;
      draw();
    });
    const name = await page.evaluate(() => state.waypoints[0].name);
    expect(name).toBe('');
  });

  test('snapExistingWaypoints snaps waypoint at airfield location when showAirfields is ON', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await page.evaluate(bg => {
      showAirfields = true;
      state.waypoints = [{ lat: bg.lat, lng: bg.lng, name: '' }];
      syncLegs(); draw();
    }, LLBG);
    await page.evaluate(() => { snapExistingWaypoints(); draw(); });
    const name = await page.evaluate(() => state.waypoints[0].name);
    expect(name).toBe('LLBG');
  });

  test('snapExistingWaypoints snaps waypoint at nav-WP location when showNavWP is ON', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => loadNavWaypoints());
    await page.waitForFunction(() => Array.isArray(window.navWP) && window.navWP.length > 0);
    await page.evaluate(() => {
      showNavWP = true;
      state.waypoints = [{ lat: 32.918611, lng: 35.096389, name: '' }];
      syncLegs(); draw();
    });
    await page.evaluate(() => { snapExistingWaypoints(); draw(); });
    const name = await page.evaluate(() => state.waypoints[0].name);
    expect(name).toBe('AAKKO');
  });

  test('snapExistingWaypoints preserves user-typed name at airfield location', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await page.evaluate(bg => {
      showAirfields = true;
      state.waypoints = [{ lat: bg.lat, lng: bg.lng, name: 'MYHOME' }];
      syncLegs(); draw();
    }, LLBG);
    await page.evaluate(() => { snapExistingWaypoints(); draw(); });
    const name = await page.evaluate(() => state.waypoints[0].name);
    expect(name).toBe('MYHOME');
  });

  test('snapExistingWaypoints replaces sequence-style label at airfield with ICAO', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await page.evaluate(bg => {
      showAirfields = true;
      state.waypoints = [{ lat: bg.lat, lng: bg.lng, name: 'WP 1' }];
      syncLegs(); draw();
    }, LLBG);
    await page.evaluate(() => { snapExistingWaypoints(); draw(); });
    const name = await page.evaluate(() => state.waypoints[0].name);
    expect(name).toBe('LLBG');
  });

  test('snapExistingWaypoints: both overlays ON, airfield nearby → snaps to airfield (priority)', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await page.evaluate(() => loadNavWaypoints());
    await page.waitForFunction(() => Array.isArray(window.navWP) && window.navWP.length > 0);
    await page.evaluate(() => {
      showAirfields = true;
      showNavWP = true;
      state.waypoints = [{ lat: 31.9672, lng: 34.7536, name: '' }];
      syncLegs(); draw();
    });
    await page.evaluate(() => { snapExistingWaypoints(); draw(); });
    const name = await page.evaluate(() => state.waypoints[0].name);
    expect(name).toBe('LLRS');
  });

  test('snapExistingWaypoints: both overlays ON, nav-WP nearby (no airfield) → snaps to nav-WP', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => loadNavWaypoints());
    await page.waitForFunction(() => Array.isArray(window.navWP) && window.navWP.length > 0);
    await page.evaluate(() => {
      showAirfields = true;
      showNavWP = true;
      state.waypoints = [{ lat: 32.918611, lng: 35.096389, name: '' }];
      syncLegs(); draw();
    });
    await page.evaluate(() => { snapExistingWaypoints(); draw(); });
    const name = await page.evaluate(() => state.waypoints[0].name);
    expect(name).toBe('AAKKO');
  });

  test('snapExistingWaypoints: waypoint far from any reference → stays empty', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await page.evaluate(() => loadNavWaypoints());
    await page.waitForFunction(() => Array.isArray(window.navWP) && window.navWP.length > 0);
    await page.evaluate(() => {
      showAirfields = true;
      showNavWP = true;
      state.waypoints = [{ lat: 33.0, lng: 36.0, name: '' }];
      syncLegs(); draw();
    });
    await page.evaluate(() => { snapExistingWaypoints(); draw(); });
    const name = await page.evaluate(() => state.waypoints[0].name);
    expect(name).toBe('');
  });
});
