// @ts-check
// Issue #399 — CVFR comm-change rendering on top of the nav-waypoint overlay.
//
// The dataset lives in docs/comm-change.json (TYONA + GALIM verified seed).
// `loadCommChange()` (draw.js) fetches the file at boot and builds
// `commChangeMap`, keyed by ICAO `name`. `drawNavWaypoints()` augments each
// matching white dot with a red outer ring; the inspector grows a "Comm
// change" badge with from / to / note for selected waypoints. A new
// "Show Comm Changes" toggle in the View section hides the rings without
// affecting the underlying dataset.
//
// These tests cover all four behaviours:
//   1. Dataset loads + commChangeMap is populated.
//   2. Ring renders at TYONA when the toggle is on.
//   3. Toggling "Show Comm Changes" off hides the ring.
//   4. Inspector shows the badge for a TYONA-named route waypoint.
//
// The renderer exposes `window.__commChangeRingsDrawn` (a Set of names
// drawn this frame) so the test can assert visibility without snapshotting
// overlay canvas pixels — see draw.js drawNavWaypoints.
const { test, expect } = require('./_setup');

// TYONA reporting point — coords lifted from docs/nav-waypoints.json.
const TYONA = { lat: 32.0047, lng: 34.7272, name: 'TYONA' };

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
  await page.goto('/?lang=en');
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

test.describe('comm-change dataset (#399)', () => {
  test('loadCommChange populates commChangeMap with the TYONA seed entry', async ({ page }) => {
    await boot(page);
    const entry = await page.evaluate(() => window.commChangeMap.TYONA);
    expect(entry).toBeTruthy();
    expect(entry.commChange).toBe(true);
    expect(typeof entry.from).toBe('string');
    expect(typeof entry.to).toBe('string');
  });

  test('drawNavWaypoints draws the comm-change ring at TYONA', async ({ page }) => {
    await boot(page);
    const drawn = await page.evaluate(() =>
      Array.from(window.__commChangeRingsDrawn || []));
    expect(drawn).toContain('TYONA');
  });

  test('toggling Show Comm Changes off hides the ring without disabling nav-WPs', async ({ page }) => {
    await boot(page);
    // Sanity check before flipping the toggle.
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
    expect(labelText).toMatch(/Comm change/i);
    // The seed entry has both from and to populated.
    const freqText = await row.locator('.commchange-freq').textContent();
    expect(freqText).toMatch(/Tel-Aviv Control/);
    expect(freqText).toMatch(/Pluto West/);
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
    expect(labelText).toMatch(/Show Comm Changes/i);
    const cb = page.locator('#commchange-cb');
    await expect(cb).toBeChecked();
  });

  test('Hebrew locale uses the translated toggle label', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('navaid.lang', 'he'); } catch (e) {}
    });
    await page.goto('/?lang=he');
    await page.waitForFunction(() => typeof state !== 'undefined');
    const labelText = await page.locator(
      'label[data-i18n-title="tbShowCommChangeTitle"]').textContent();
    expect(labelText).toMatch(/הצג מעברי תקשורת/);
  });
});
