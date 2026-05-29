// @ts-check
// Issue #418 — Inspector "↺ Reset waypoint name", toolbar reset-all, and
// sequence-placeholder naming (draw.js / io.js / ui.js).
//
// Behaviour:
//   1. Waypoint sits on a known airfield (within ~18 px) → wp.name
//      becomes the airfield ICAO (e.g. 'LLBG').
//   2. Else within ~18 px of a known nav-waypoint → wp.name becomes
//      that point's 5-letter code (e.g. 'TYONA').
//   3. Otherwise → wp.name is cleared ('') so the UI shows the dimmed
//      sequence placeholder (S.wpPrefix + 1-based index).
const { test, expect } = require('./_setup');

async function boot(page, lang = 'en') {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_reset_wp_name_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build', 'view', 'display', 'charts', 'export', 'print']) {
          localStorage.setItem('navaid.sec.' + s, '1');
        }
        localStorage.setItem('__test_reset_wp_name_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('/?lang=' + lang);
  await page.waitForFunction(() =>
    typeof state !== 'undefined' &&
    typeof showInspector === 'function' &&
    typeof window.resetWpName === 'function' &&
    typeof window.resetAllWpNames === 'function');
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
      state.waypoints = [{ lat: 32.009444, lng: 34.885556, name: 'TYPO' }];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    await page.locator('.insp-btn').filter({ hasText: /Reset waypoint name/ }).click();
    const name = await page.evaluate(() => state.waypoints[0].name);
    expect(name).toBe('LLBG');
  });

  test('off-grid single waypoint → name cleared; inspector shows placeholder WP1', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 33.5, lng: 33.0, name: 'somethingCustom' }];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    await page.locator('.insp-btn').filter({ hasText: /Reset waypoint name/ }).click();
    const { stored, titleVal, ph } = await page.evaluate(() => ({
      stored: state.waypoints[0].name,
      titleVal: document.getElementById('insp-title').value,
      ph: document.getElementById('insp-title').placeholder,
    }));
    expect(stored).toBe('');
    expect(titleVal).toBe('');
    expect(ph).toMatch(/^WP/);
    expect(ph).toContain('1');
  });

  test('off-grid third waypoint of three → third name cleared (first two unchanged)', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.18060, lng: 34.83470, name: 'LLHZ' },
        { lat: 32.80972, lng: 35.04389, name: 'LLHA' },
        { lat: 33.5, lng: 33.0, name: 'pickMeReset' },
      ];
      state.selected = { type: 'wp', index: 2 };
      syncLegs(); draw(); showInspector();
    });
    await page.locator('.insp-btn').filter({ hasText: /Reset waypoint name/ }).click();
    const names = await page.evaluate(() => state.waypoints.map(w => w.name));
    expect(names[0]).toBe('LLHZ');
    expect(names[1]).toBe('LLHA');
    expect(names[2]).toBe('');
    const ph = await page.evaluate(() => document.getElementById('insp-title').placeholder);
    expect(ph).toContain('3');
  });

  test('reset persists to localStorage (navaid.route)', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.00472, lng: 34.72722, name: 'OLD' }];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    await page.locator('.insp-btn').filter({ hasText: /Reset waypoint name/ }).click();
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

  test('inspector Delete Waypoint label includes trash icon', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'x' }];
      state.selected = { type: 'wp', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    const del = await page.locator('#insp-body .insp-btn').filter({ hasText: /Delete Waypoint/ }).textContent();
    expect(del).toMatch(/🗑/);
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
    expect(names).toEqual(['TYONA', 'LLBG', '']);
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

  test('findSnappedReference: airfield wins at LLBG even when overlays were off', async ({ page }) => {
    await boot(page);
    const code = await page.evaluate(() => {
      showAirfields = false;
      showNavWP = false;
      const wp = { lat: 32.009444, lng: 34.885556, name: 'X' };
      const r = findSnappedReference(wp);
      return r && r.name;
    });
    expect(code).toBe('LLBG');
  });

  // Split EN / HE: each `boot()` waits on JSON fetches; two boots in one test
  // often exceeded the default 30s test timeout on CI / e2e-deployed.
  test('isSequenceWaypointName recognises WP 1 and WP1 (English)', async ({ page }) => {
    await boot(page);
    const en = await page.evaluate(() => ({
      a: isSequenceWaypointName('WP 1'),
      b: isSequenceWaypointName('WP1'),
      c: isSequenceWaypointName('TYONA'),
    }));
    expect(en.a).toBe(true);
    expect(en.b).toBe(true);
    expect(en.c).toBe(false);
  });

  test('isSequenceWaypointName recognises Hebrew נק׳ 2 and נק׳2', async ({ page }) => {
    await boot(page, 'he');
    const he = await page.evaluate(() => ({
      d: isSequenceWaypointName('נק׳ 2'),
      e: isSequenceWaypointName('נק׳2'),
    }));
    expect(he.d).toBe(true);
    expect(he.e).toBe(true);
  });

  test('waypointGeom uses wpPrefix + index for unnamed waypoint (not bare digit)', async ({ page }) => {
    await boot(page);
    const label = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.9, name: '' }];
      syncLegs();
      return waypointGeom(0).label;
    });
    expect(label).toBe('WP 1');
  });

  test('Hebrew waypointGeom label uses Hebrew wpPrefix', async ({ page }) => {
    await boot(page, 'he');
    const label = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.9, name: '' }];
      syncLegs();
      return waypointGeom(0).label;
    });
    expect(label).toContain('נק׳');
    expect(label).toContain('1');
  });

  test('inspector: typing sequence text "WP 3" into title clears stored name', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.0, lng: 34.9, name: 'A' },
        { lat: 32.1, lng: 35.0, name: 'B' },
        { lat: 32.2, lng: 35.1, name: 'C' },
      ];
      state.selected = { type: 'wp', index: 2 };
      syncLegs(); draw(); showInspector();
    });
    const title = page.locator('#insp-title');
    await title.fill('WP 3');
    const stored = await page.evaluate(() => state.waypoints[2].name);
    expect(stored).toBe('');
  });

  test('flight plan: typing "WP 1" in From cell clears stored waypoint name', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.18060, lng: 34.83470, name: 'LLHZ' },
        { lat: 32.21861, lng: 34.88250, name: 'BAZRA' },
      ];
      state.legs = [{
        inboundAltitude: 1500,
        outboundAltitude: 2000,
        flightSpeed: 90,
        outboundSpeed: 90,
        inLabel: { a: 0, p: 44 },
        outLabel: { a: 0, p: -44 },
      }];
      syncLegs(); draw();
    });
    await page.locator('#plan').click();
    const modal = page.locator('.modal-back.flight-plan');
    await expect(modal).toBeVisible();
    const firstFrom = modal.locator('tbody tr').first().locator('td').nth(1).locator('input');
    await firstFrom.fill('WP 1');
    const stored = await page.evaluate(() => state.waypoints[0].name);
    expect(stored).toBe('');
  });

  test('toolbar reset-all button title documents reference snap behaviour', async ({ page }) => {
    await boot(page);
    const title = await page.locator('#tool-reset-all-wp-names').getAttribute('title');
    expect(title).toMatch(/nearest reference|off-grid/i);
  });

  test('Hebrew toolbar reset-all label and delete-note pattern', async ({ page }) => {
    await boot(page, 'he');
    const tb = await page.locator('#tool-reset-all-wp-names').textContent();
    expect(tb).toMatch(/אפס את כל שמות ציוני הדרך/);
    const delNoteStr = await page.evaluate(() => S.deleteNote);
    expect(delNoteStr).toMatch(/🗑/);
    await page.evaluate(() => {
      state.notes = [{ lat: 32.0, lng: 34.9, text: 'n' }];
      state.selected = { type: 'note', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    const delNote = await page.locator('#insp-body .insp-btn').filter({ hasText: /מחק הערה/ }).textContent();
    expect(delNote).toMatch(/🗑/);
  });
});
