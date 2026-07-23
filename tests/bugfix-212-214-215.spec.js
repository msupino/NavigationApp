// @ts-check
// Tests for PR #216: three JS fixes.
//   #212 — validateRoute uses hasOwnProperty so Object.prototype pollution
//           cannot satisfy the optional outboundSpeed check
//   #214 — draw() skips persist() while NavAid.exporting is true
//   #215 — exportPNG .catch() restores button + NavAid.exporting on failure
const { test, expect } = require('./_setup');
const { pairLLHZ_LLHA } = require('./_airfieldArp');

// Shared two-waypoint route (one leg) used across all three suites.
const TWO_WP_ROUTE = {
  waypoints: pairLLHZ_LLHA(),
  legs: [{
    inboundAltitude: 1500, outboundAltitude: 2000, flightSpeed: 90,
    inLabel: { a: 0, p: 44 }, outLabel: { a: 0, p: -44 },
  }],
  notes: [],
};

async function boot(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_212_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_212_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof syncLegs === 'function');
}

async function loadRoute(page) {
  await page.evaluate(r => {
    state.waypoints = r.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
    syncLegs();
    draw();
  }, TWO_WP_ROUTE);
}

// Upload JSON to the hidden #file input. Returns the alert message or null.
async function uploadAndCapture(page, contents) {
  let alerted = null;
  page.once('dialog', d => { alerted = d.message(); d.accept(); });
  await page.setInputFiles('#file', {
    name: 'route.json', mimeType: 'application/json',
    buffer: Buffer.from(contents, 'utf8'),
  });
  await page.waitForTimeout(200);
  return alerted;
}

// ---------------------------------------------------------------------------
// #212: hasOwnProperty prevents prototype-inherited outboundSpeed from
//       triggering a spurious type error in validateRoute.
// ---------------------------------------------------------------------------
test.describe('#212 — hasOwnProperty in validateRoute', () => {
  test('prototype-poisoned outboundSpeed: valid route imports cleanly', async ({ page }) => {
    await boot(page);
    await loadRoute(page);

    // Poison Object.prototype.outboundSpeed AFTER app init so Leaflet is unaffected.
    // With the old `in` check this would make validateRoute see the inherited string
    // value and reject the import; with hasOwnProperty it is correctly ignored.
    await page.evaluate(() => { Object.prototype.outboundSpeed = 'POISONED'; });

    // Route whose leg has no own outboundSpeed property.
    const blob = JSON.stringify(TWO_WP_ROUTE);
    const alerted = await uploadAndCapture(page, blob);

    // No error alert — import accepted.
    expect(alerted).toBeNull();
    const names = await page.evaluate(() => state.waypoints.map(w => w.name));
    expect(names).toEqual(['LLHZ', 'LLHA']);
  });

  test('own outboundSpeed that is a string: rejected', async ({ page }) => {
    await boot(page);
    await loadRoute(page);
    const bad = {
      ...TWO_WP_ROUTE,
      legs: [{ ...TWO_WP_ROUTE.legs[0], outboundSpeed: 'not-a-number' }],
    };
    const alerted = await uploadAndCapture(page, JSON.stringify(bad));
    expect(alerted).toMatch(/outboundSpeed.*expected number/);
  });

  test('own outboundSpeed that is a number: accepted', async ({ page }) => {
    await boot(page);
    await loadRoute(page);
    const good = {
      ...TWO_WP_ROUTE,
      legs: [{ ...TWO_WP_ROUTE.legs[0], outboundSpeed: 80 }],
    };
    const alerted = await uploadAndCapture(page, JSON.stringify(good));
    expect(alerted).toBeNull();
    const names = await page.evaluate(() => state.waypoints.map(w => w.name));
    expect(names).toEqual(['LLHZ', 'LLHA']);
  });
});

// ---------------------------------------------------------------------------
// #214: draw() must not call persist() while NavAid.exporting is true.
// ---------------------------------------------------------------------------
test.describe('#214 — persist guard during PNG export', () => {
  test('draw() with NavAid.exporting=true does not write to localStorage', async ({ page }) => {
    await boot(page);
    await loadRoute(page);

    // Let initial persist debounce fire (500 ms timeout + slack).
    await page.waitForTimeout(800);

    // Rename a waypoint and take a snapshot of the current stored route.
    await page.evaluate(() => { state.waypoints[0].name = 'ORIGINAL'; draw(); });
    await page.waitForTimeout(800);
    const before = await page.evaluate(() => localStorage.getItem('navaid.route'));
    expect(before).toContain('ORIGINAL');

    // Now simulate exporting: set flag, mutate state, call draw().
    await page.evaluate(() => {
      NavAid.exporting = true;
      state.waypoints[0].name = 'SHOULD_NOT_PERSIST';
      draw();
    });
    await page.waitForTimeout(800);

    // localStorage must still reflect the pre-export name.
    const during = await page.evaluate(() => localStorage.getItem('navaid.route'));
    expect(during).toContain('ORIGINAL');
    expect(during).not.toContain('SHOULD_NOT_PERSIST');

    // Once exporting ends, draw() should persist again.
    await page.evaluate(() => { NavAid.exporting = false; draw(); });
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => localStorage.getItem('navaid.route'));
    expect(after).toContain('SHOULD_NOT_PERSIST');
  });
});

// ---------------------------------------------------------------------------
// #215: exportPNG .catch() restores the Export button and NavAid.exporting.
// ---------------------------------------------------------------------------
test.describe('#215 — exportPNG catch handler restores UI', () => {
  test('button re-enabled and NavAid.exporting cleared after pipeline failure', async ({ page }) => {
    await boot(page);
    await loadRoute(page);

    // Open the inline export options panel; the Export button is the first of
    // the two action buttons (Export + Print).
    await page.evaluate(() => openExportPanel());
    const btn = page.locator('#export-panel .export-panel-btns button').first();
    await btn.waitFor();

    // Inject a failure: replace Promise.all so the tile pipeline immediately
    // rejects, triggering the .catch() handler in exportPNG.
    await page.evaluate(() => {
      const origAll = Promise.all.bind(Promise);
      Promise.all = function (arr) {
        // Only hijack once (the exportPNG tile gather) then restore.
        Promise.all = origAll;
        return Promise.reject(new Error('mock-pipeline-failure'));
      };
    });

    // Click Export — calls exportPNG().
    await btn.first().click();

    // Wait for the catch handler to fire and restore the button.
    await expect(btn).toBeEnabled({ timeout: 5000 });

    // NavAid.exporting must be cleared.
    const exporting = await page.evaluate(() => NavAid.exporting);
    expect(exporting).toBe(false);

    // Button label should be restored (not stuck on "Saving…").
    const label = await btn.textContent();
    expect(label).not.toMatch(/saving/i);
  });
});
