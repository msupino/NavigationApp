// @ts-check
// Issue #418 — Inspector "↺ Reset waypoint name" button.
//
// Behaviour:
//   1. Waypoint sits on a known airfield (within ~18 px) → wp.name
//      becomes the airfield ICAO (e.g. 'LLBG').
//   2. Else within ~18 px of a known nav-waypoint → wp.name becomes
//      that point's 5-letter code (e.g. 'TYONA').
//   3. Otherwise → wp.name becomes `WP{N}` where N is the 1-based
//      index of the waypoint in state.waypoints.
//   4. Hebrew locale shows the translated button label.
const { test, expect } = require('./_setup');

async function boot(page, lang = 'en') {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_reset_wp_name_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_reset_wp_name_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('/?lang=' + lang);
  await page.waitForFunction(() =>
    typeof state !== 'undefined' &&
    typeof showInspector === 'function' &&
    typeof resetWpName === 'function' &&
    typeof resetAllWpNames === 'function');
  // Both overlays load lazily but the snap helpers depend on them being
  // populated. Kick the loads and wait so resetWpName() can resolve.
  await page.evaluate(() => loadNavWaypoints && loadNavWaypoints());
  await page.evaluate(() => loadAirfields && loadAirfields());
  await page.waitForFunction(() =>
    Array.isArray(window.navWP) && window.navWP.length > 0 &&
    Array.isArray(window.airfields) && window.airfields.length > 0);
}

test.describe('#418 — Reset waypoint name button', () => {
  test('snap to nav waypoint: TYONA coords → wp.name === "TYONA"', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      // TYONA published coords (nav-waypoints.json row).
      state.waypoints = [{ lat: 32.00472, lng: 34.72722, name: 'FOO' }];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    await page.locator('.insp-btn').filter({ hasText: /Reset waypoint name/ }).click();
    const name = await page.evaluate(() => state.waypoints[0].name);
    expect(name).toBe('TYONA');
  });

  test('snap to airfield: LLBG coords → wp.name === "LLBG"', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      // LLBG (Ben Gurion) published coords (airfields.json row).
      state.waypoints = [{ lat: 32.009444, lng: 34.885556, name: 'TYPO' }];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    await page.locator('.insp-btn').filter({ hasText: /Reset waypoint name/ }).click();
    const name = await page.evaluate(() => state.waypoints[0].name);
    expect(name).toBe('LLBG');
  });

  test('off-grid single waypoint → wp.name === "WP1"', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      // Open Mediterranean, far from any published reference point.
      state.waypoints = [{ lat: 33.5, lng: 33.0, name: 'somethingCustom' }];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    await page.locator('.insp-btn').filter({ hasText: /Reset waypoint name/ }).click();
    const name = await page.evaluate(() => state.waypoints[0].name);
    expect(name).toBe('WP1');
  });

  test('off-grid third waypoint of three → wp.name === "WP3" (1-based index)', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.18060, lng: 34.83470, name: 'LLHZ' },        // airfield #1
        { lat: 32.80972, lng: 35.04389, name: 'LLHA' },        // airfield #2
        { lat: 33.5,     lng: 33.0,     name: 'pickMeReset' }, // off-grid
      ];
      state.selected = { type: 'wp', index: 2 };
      syncLegs(); draw(); showInspector();
    });
    await page.locator('.insp-btn').filter({ hasText: /Reset waypoint name/ }).click();
    const names = await page.evaluate(() => state.waypoints.map(w => w.name));
    expect(names[0]).toBe('LLHZ');
    expect(names[1]).toBe('LLHA');
    expect(names[2]).toBe('WP3');
  });

  test('reset persists to localStorage (navaid.route)', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.00472, lng: 34.72722, name: 'OLD' }];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    await page.locator('.insp-btn').filter({ hasText: /Reset waypoint name/ }).click();
    // persist() is debounced via setTimeout — give the queued write a tick.
    await page.waitForFunction(() => {
      try {
        const blob = JSON.parse(localStorage.getItem('navaid.route') || '{}');
        return blob.waypoints && blob.waypoints[0] && blob.waypoints[0].name === 'TYONA';
      } catch (e) { return false; }
    });
  });

  test('Hebrew locale: button label is "↺ אפס שם נקודה"', async ({ page }) => {
    await boot(page, 'he');
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'הבדיקה' }];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    const text = await page.locator('.insp-btn')
      .filter({ hasText: /אפס שם נקודה/ }).textContent();
    expect(text).toMatch(/↺ אפס שם נקודה/);
  });

  test('button is positioned directly below Delete Waypoint', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'x' }];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    const texts = await page.locator('#insp-body .insp-btn').allTextContents();
    const di = texts.findIndex(t => /Delete Waypoint/i.test(t));
    const ri = texts.findIndex(t => /Reset waypoint name/i.test(t));
    expect(di).toBeGreaterThanOrEqual(0);
    expect(ri).toBe(di + 1);
  });

  test('toolbar: reset all waypoint names (confirm)', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.00472, lng: 34.72722, name: 'FOO' },
        { lat: 32.009444, lng: 34.885556, name: 'BAR' },
        { lat: 33.5, lng: 33.0, name: 'Z' },
      ];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    page.once('dialog', d => d.accept());
    await page.locator('#tool-reset-all-wp-names').click();
    const names = await page.evaluate(() => state.waypoints.map(w => w.name));
    expect(names).toEqual(['TYONA', 'LLBG', 'WP3']);
  });

  test('toolbar: reset all names — cancel leaves names unchanged', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.00472, lng: 34.72722, name: 'KEEP' },
      ];
      syncLegs(); draw();
    });
    page.once('dialog', d => d.dismiss());
    await page.locator('#tool-reset-all-wp-names').click();
    const name = await page.evaluate(() => state.waypoints[0].name);
    expect(name).toBe('KEEP');
  });

  test('toolbar: reset all with zero waypoints is a no-op', async ({ page }) => {
    await boot(page);
    let dialogCount = 0;
    page.on('dialog', () => { dialogCount++; });
    await page.locator('#tool-reset-all-wp-names').click();
    expect(dialogCount).toBe(0);
  });
});
