// @ts-check
// Issue #399 — CVFR comm-change rendering on top of the nav-waypoint overlay.
//
// As of PR #401 the shipped dataset (docs/comm-change.json) is intentionally
// empty (`points: []`) — the schema + rendering + toolbar toggle merge as
// plumbing, but no points are listed until a chart-specific source surfaces
// (PAMAT chapter B-03 / IAA AIP supplement / printed CVFR chart). Earlier
// inferences from sector-boundary geometry were removed (`points: []`).
//
// These tests therefore split into two groups:
//
//   1. SHIPPED-FILE TESTS: assert the toolbar/checkbox/dom presence and the
//      graceful-empty behaviour against the real docs/comm-change.json
//      (commChangeMap is {} — no rings, no badges).
//
//   2. FIXTURE-BACKED TESTS: stub the comm-change.json fetch with a small
//      synthetic dataset (TYONA + SORES + BAZRA) so we still exercise the
//      load + ring-draw + inspector-badge code paths without depending on
//      real chart data. Uses Playwright's page.route to intercept the
//      `comm-change.json?v=...` request before the app fetches it.
//
// The renderer exposes `window.__commChangeRingsDrawn` (a Set of names drawn
// this frame) so the tests can assert visibility without snapshotting overlay
// canvas pixels — see draw.js drawNavWaypoints.
const { test, expect } = require('./_setup');

// TYONA reporting point — coords lifted from docs/nav-waypoints.json. Used
// by the fixture-backed group as the "verified" stand-in.
const TYONA = { lat: 32.0047, lng: 34.7272, name: 'TYONA' };

// Synthetic fixture matching docs/comm-change.json's schema. Three entries
// cover every branch the renderer + inspector care about:
//   * TYONA  — verified=true with from/to (full badge incl. freq row)
//   * SORES  — verified=false with from/to (inferred path still draws)
//   * BAZRA  — commChange:true with note but NO from/to (freq-row omitted)
const FIXTURE = {
  version: 1,
  source: 'test fixture',
  _definition: 'test fixture entries — not real chart data',
  points: [
    {
      name: 'TYONA',
      commChange: true,
      from: 'Tel-Aviv Control 121.40 / 124.30',
      to: 'Pluto West 118.40',
      note: 'test fixture entry',
      verified: true,
      source: 'test fixture',
    },
    {
      name: 'SORES',
      commChange: true,
      from: 'Pluto West 118.40',
      to: 'Hagav North 128.35',
      note: 'test fixture entry (inferred)',
      verified: false,
      source: 'test fixture',
    },
    {
      name: 'BAZRA',
      commChange: true,
      note: 'test fixture entry — frequencies intentionally omitted',
      verified: false,
      source: 'test fixture',
    },
  ],
};

// Install a route handler for the comm-change.json request. Matches the
// shipped URL pattern `comm-change.json?v=...` regardless of query string.
// MUST be called before `boot(page)` (i.e. before any page.goto) so the
// stub is registered before the app's first fetch.
async function installCommChangeFixture(page, fixture = FIXTURE) {
  await page.route('**/comm-change.json*', route => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixture),
    });
  });
}

async function boot(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_commchange_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        // Open every accordion section so the comm-change checkbox is in
        // the DOM as a styled control, not just a hidden node.
        for (const s of ['build', 'view', 'display', 'charts', 'export', 'print']) {
          localStorage.setItem('navaid.sec.' + s, '1');
        }
        localStorage.setItem('__test_commchange_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined');
  // Pre-warm every async dataset so subsequent draws / inspector renders
  // can assert against fully-populated state.
  await page.evaluate(() => loadNavWaypoints());
  await page.waitForFunction(() => Array.isArray(window.navWP) && window.navWP.length > 0);
  await page.evaluate(() => loadCommChange());
  await page.waitForFunction(() => window.commChangeMap &&
    typeof window.commChangeMap === 'object');
  // Frame the map on TYONA so the nav-WP dot lands in the viewport at a
  // high-enough zoom for drawNavWaypoints to project it on-canvas.
  await page.evaluate(t => map.setView([t.lat, t.lng], 11), TYONA);
  await page.waitForTimeout(80);          // let scheduleDraw flush an RAF
  await page.evaluate(() => draw());
}

test.describe('comm-change schema + UI plumbing (shipped populated dataset)', () => {
  test('shipped docs/comm-change.json parses and loads commChange points', async ({ page }) => {
    await boot(page);
    const map = await page.evaluate(() => window.commChangeMap);
    expect(map).toBeTruthy();
    expect(typeof map).toBe('object');
    const keys = Object.keys(map);
    expect(keys.length).toBeGreaterThan(0);
    // Every shipped entry is keyed by a 5-letter ICAO name and flagged commChange.
    for (const k of keys) {
      expect(k).toMatch(/^[A-Z]{5}$/);
      expect(map[k].commChange).toBe(true);
    }
    expect(map.TYONA).toBeTruthy();
    expect(map.TYONA.callSigns).toContain('PLUTO_WEST');
    expect(map.TYONA.callSigns).toContain('PALMACHIM');
    expect(map.AAKKO.callSigns).toEqual(['PLUTO_EAST', 'HAIFA']);
    expect(map.BASAN.callSigns).toEqual(['KIRYAT_SHMONA', 'PLUTO_EAST']);
    expect(map.DAROM.callSigns).toEqual(['HAIFA', 'PLUTO_WEST']);
    expect(map.DEROR.callSigns).toEqual(['HERZLIYA', 'PLUTO_WEST']);
    expect(map.DESHE.callSigns).toEqual(['ROSH_PINA', 'PLUTO_EAST']);
    expect(map.GILAM.callSigns).toEqual(['HAIFA', 'PLUTO_EAST']);
    expect(map.HAROV.callSigns).toEqual(['PLUTO_EAST', 'PIK']);
    const catalog = await page.evaluate(() => window.commChangeCallSigns);
    expect(catalog.PLUTO_WEST.label).toBe('Pluto West');
    expect(catalog.PLUTO_WEST.primary).toBe('118.40');
    expect(catalog.PLUTO_WEST.secondary).toBe('119.15');
    expect(catalog.PLUTO_WEST.unit).toBe('יב"א 506');
    expect(catalog.PALMACHIM.label).toBe('Palmachim');
    expect(catalog.PALMACHIM.primary).toBe('135.55');
    expect(catalog.PALMACHIM.secondary).toBe('118.25');
    expect(catalog.HAIFA.he).toBe('חיפה');
    expect(catalog.HAIFA.primary).toBe('133');
    expect(catalog.KIRYAT_SHMONA.he).toBe('קריית שמונה');
    expect(catalog.KIRYAT_SHMONA.primary).toBe('126.9');
    expect(catalog.ROSH_PINA.he).toBe('ראש פינה');
    expect(catalog.ROSH_PINA.primary).toBe('118.45');
    expect(catalog.PLUTO_EAST.he).toBe('פלוטו מזרח');
    expect(catalog.PLUTO_EAST.primary).toBe('123.85');
    expect(catalog.PIK.he).toBe('פיק');
    expect(catalog.PIK.primary).toBe('122.55');
    expect(catalog.HAGAV_NORTH.primary).toBe('128.35');
    expect(catalog.HAGAV_NORTH.secondary).toBe('129.25');
  });

  test('populated dataset draws comm-change rings for in-view points', async ({ page }) => {
    await boot(page);   // boot() frames the map on TYONA
    await page.evaluate(() => { window.showCommChange = true; draw(); });
    const drawn = await page.evaluate(() =>
      Array.from(window.__commChangeRingsDrawn || []));
    expect(drawn).toContain('TYONA');
  });

  test('a waypoint whose name is not in the dataset shows no badge', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'NOPE_TOKEN' }];
      state.legs = [];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
      draw();
    });
    await expect(page.locator('#inspector .commchange-row')).toHaveCount(0);
  });

  test('toolbar exposes a "Show Comm Changes" checkbox in the View section', async ({ page }) => {
    await boot(page);
    const labelText = await page.locator(
      'label[data-i18n-title="tbShowCommChangeTitle"]').textContent();
    expect(labelText).toMatch(/Show\/Add Freq Changes/i);
    const cb = page.locator('#commchange-cb');
    await expect(cb).not.toBeChecked();
  });

  test('Hebrew locale uses the translated toggle label', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('navaid.lang', 'he'); } catch (e) {}
    });
    await page.goto('?lang=he');
    await page.waitForFunction(() => typeof state !== 'undefined');
    const labelText = await page.locator(
      'label[data-i18n-title="tbShowCommChangeTitle"]').textContent();
    expect(labelText).toMatch(/הצג\/הוסף שינויי תדר/);
  });
});

test.describe('comm-change rendering (fixture-backed)', () => {
  test('loadCommChange populates commChangeMap with the fixture entries', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const tyona = await page.evaluate(() => window.commChangeMap.TYONA);
    expect(tyona).toBeTruthy();
    expect(tyona.commChange).toBe(true);
    expect(typeof tyona.from).toBe('string');
    expect(typeof tyona.to).toBe('string');
  });

  test('drawNavWaypoints draws the comm-change ring at TYONA', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.evaluate(() => { window.showCommChange = true; draw(); });
    const drawn = await page.evaluate(() =>
      Array.from(window.__commChangeRingsDrawn || []));
    expect(drawn).toContain('TYONA');
  });

  test('toggling Show Comm Changes off hides the ring without disabling nav-WPs', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    // Enable the toggle first (default is now off).
    await page.evaluate(() => {
      const cb = document.getElementById('commchange-cb');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => window.showCommChange === true);
    await page.evaluate(() => draw());
    // Sanity check before flipping back.
    let drawn = await page.evaluate(() =>
      Array.from(window.__commChangeRingsDrawn || []));
    expect(drawn).toContain('TYONA');
    // Flip the checkbox via its native onchange (mirrors the user path).
    await page.evaluate(() => {
      const cb = document.getElementById('commchange-cb');
      cb.checked = false;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // The onchange handler calls draw() synchronously after the load
    // (which is a resolved promise once commChangeMap is populated).
    await page.waitForFunction(() => window.showCommChange === false);
    await page.evaluate(() => draw());
    drawn = await page.evaluate(() =>
      Array.from(window.__commChangeRingsDrawn || []));
    expect(drawn).not.toContain('TYONA');
    // Nav-WPs themselves should still be enabled (the toggle only hides
    // the augment, not the underlying overlay).
    const navOn = await page.evaluate(() => window.showNavWP === true);
    expect(navOn).toBe(true);
    // Persistence: the toggle wrote '0' to navaid.showCommChange.
    const stored = await page.evaluate(() => localStorage.getItem('navaid.showCommChange'));
    expect(stored).toBe('0');
  });

  test('inspector grows a Comm change badge for a TYONA-named route waypoint', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    // Drop a route waypoint at TYONA's coords with the canonical name.
    // The wp lookup uses the stored `name`, so this exercises both the
    // auto-snap path (where a click near TYONA adopts the name) and the
    // search-build path (which also stores the canonical ICAO).
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      state.legs = [];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
      draw();
    }, TYONA);
    const row = page.locator('#inspector .commchange-row');
    await expect(row).toBeVisible();
    const labelText = await row.locator('.commchange-label').textContent();
    expect(labelText).toMatch(/Freq change/i);
    // The fixture entry has both from and to populated.
    const freqText = await row.locator('.commchange-freq').textContent();
    expect(freqText).toMatch(/Tel-Aviv Control/);
    expect(freqText).toMatch(/Pluto West/);
  });

  test('inferred (verified=false) fixture entries still populate commChangeMap', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const sores = await page.evaluate(() => window.commChangeMap.SORES);
    expect(sores).toBeTruthy();
    expect(sores.commChange).toBe(true);
    expect(sores.verified).toBe(false);
  });

  test('fixture entry without from/to renders badge + note, omits freq row', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    // BAZRA in the fixture is the "frequencies not confirmed" case — the
    // entry has commChange:true + note but no from/to, exercising the
    // optional freq-row branch in showInspector().
    const BAZRA = { lat: 32.21861111111112, lng: 34.8825, name: 'BAZRA' };
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      state.legs = [];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
      draw();
    }, BAZRA);
    const row = page.locator('#inspector .commchange-row');
    await expect(row).toBeVisible();
    await expect(row.locator('.commchange-label')).toBeVisible();
    await expect(row.locator('.commchange-note')).toBeVisible();
    // No from/to → no .commchange-freq element rendered.
    await expect(row.locator('.commchange-freq')).toHaveCount(0);
  });

  test('comm-change rings draw with the nav-WP dot layer OFF (decoupled, #484)', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    // Turn the nav-WP dot layer off but keep comm-change on: the ring must
    // still draw (it no longer lives inside drawNavWaypoints' early-return).
    await page.evaluate(async () => {
      window.showNavWP = false;
      window.showCommChange = true;  // default is now off
      // navWP positions are still required — loaded by the comm toggle/boot.
      if (typeof loadNavWaypoints === 'function') await loadNavWaypoints();
      draw();
    });
    const drawn = await page.evaluate(() =>
      Array.from(window.__commChangeRingsDrawn || []));
    expect(await page.evaluate(() => window.showNavWP)).toBe(false);
    expect(drawn).toContain('TYONA');
  });

  test('ring grows to enclose a named route-waypoint disc so it stays visible (#488)', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.evaluate(() => { window.showCommChange = true; draw(); });
    // Bare ring radius with no route waypoint on the point.
    const bare = await page.evaluate(() => {
      state.waypoints = []; state.legs = []; syncLegs();
      draw();
      return window.__commChangeRingRadii.TYONA;
    });
    // Drop a route waypoint on TYONA with "show waypoint names" ON — the
    // label-enlarged yellow disc would otherwise cover the bare ring.
    const grown = await page.evaluate(t => {
      window.showWpNames = true;
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      state.legs = []; syncLegs();
      draw();
      return {
        ring: window.__commChangeRingRadii.TYONA,
        disc: waypointGeom(0).r,
      };
    }, TYONA);
    // Ring must now exceed both its bare size and the occupying disc radius.
    expect(grown.ring).toBeGreaterThan(bare);
    expect(grown.ring).toBeGreaterThan(grown.disc);
  });

  test('nav-WP dots draw with comm-change OFF and no rings (decoupled, #484)', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.evaluate(() => {
      window.showNavWP = true;
      window.showCommChange = false;
      draw();
    });
    const drawn = await page.evaluate(() =>
      Array.from(window.__commChangeRingsDrawn || []));
    expect(drawn).toHaveLength(0);
    expect(await page.evaluate(() => window.showNavWP)).toBe(true);
  });
});
