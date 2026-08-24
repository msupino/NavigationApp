// @ts-check
// Regression coverage for recent merged PRs that lacked behavioural tests.
// One suite per PR — each asserts the user-visible symptom, not the
// implementation, so refactors won't break them unnecessarily.
//
//   #218 — 'Show'  → 'Show/pin' relabel for the two map-overlay toggles
//   #232 — runway directions are already covered by runway-directions.spec.js
//   #238 — toolbar section order: Build → View → Display → Charts →
//          Export/import → Print
//   #250 — export-PNG modal checkbox labels match the View section
//          terminology ('navigation waypoints' / 'airfields')
//   #251 — the Hebrew opacity label is the new wording, not the old 'מפת רקע'. The slider
//          was renamed again since (Map opacity -> Layer opacity, בהירות מפה ->
//          בהירות השכבה) when the map under the chart became a chart of its own: what it
//          dims is the layer you picked. The point #251 fixed is unchanged -- the label
//          must not read 'מפת רקע'.
const { test, expect } = require('./_setup');
const { pairLLHZ_LLHA } = require('./_airfieldArp');

async function boot(page, lang = 'en') {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_recent_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_recent_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=' + lang);
  await page.waitForFunction(() => typeof state !== 'undefined');
}

// ---------------------------------------------------------------------------
// #218 — Show/pin label relabel.
// ---------------------------------------------------------------------------
test.describe('#218 — Show/pin label relabel', () => {
  test('navWP toggle label reads "Show/pin nav waypoints"', async ({ page }) => {
    await boot(page);
    const text = await page.locator('label[data-i18n-title="tbShowNavWpTitle"]').textContent();
    // #526: shortened from "navigation waypoints" so it stops clipping at the
    // 240px toolbar edge; still the "nav waypoints" wording (not the reverted
    // "map waypoints" from #310).
    expect(text).toMatch(/Show\/pin nav waypoints/i);
  });

  test('airfields toggle label reads "Show/pin airfields"', async ({ page }) => {
    await boot(page);
    const text = await page.locator('label[data-i18n-title="tbShowAirfieldsTitle"]').textContent();
    expect(text).toMatch(/Show\/pin airfields/i);
  });
});

// ---------------------------------------------------------------------------
// #238 — toolbar section order.
// ---------------------------------------------------------------------------
test.describe('#238 — toolbar section order', () => {
  test('sections render in order: build, view, display, plan, charts, export, weather, print', async ({ page }) => {
    await boot(page);
    const order = await page.locator('#toolbar .tb-section').evaluateAll(els =>
      els.map(el => el.getAttribute('data-sec')));
    // 'plan' is the standalone Flight-plan action promoted out of Charts — it sits
    // just before it, so the reference tables stay grouped after the main output.
    expect(order).toEqual(['build', 'view', 'display', 'plan', 'charts', 'export', 'weather', 'print']);
  });
});

// ---------------------------------------------------------------------------
// #250 — export-PNG checkbox labels match View section terminology.
// ---------------------------------------------------------------------------
test.describe('#250 — export modal checkbox label terminology', () => {
  test('Print PNG modal labels use navigation waypoints / airfields wording', async ({ page }) => {
    await boot(page);
    await page.evaluate(wps => {
      state.waypoints = wps;
      syncLegs(); draw();
    }, pairLLHZ_LLHA());
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();

    const labels = await page.locator('.modal label').allTextContents();
    const joined = labels.join(' ');
    expect(joined).toMatch(/navigation waypoints/i);
    expect(joined).toMatch(/airfields/i);
    // No leftover legacy 'airports' wording (renamed to Airfields in #250).
    expect(joined).not.toMatch(/\bairports\b/i);
  });
});

// ---------------------------------------------------------------------------
// #251 — the Hebrew opacity-slider wording.
// ---------------------------------------------------------------------------
test.describe('#251 — Hebrew opacity-slider label', () => {
  test('the Hebrew opacity slider reads בהירות השכבה', async ({ page }) => {
    await boot(page, 'he');
    const text = await page.locator('label[data-i18n-title="tbLayerOpacityTitle"]').textContent();
    expect(text).toMatch(/בהירות השכבה/);
    // Old wording must be gone.
    expect(text).not.toMatch(/מפת רקע/);
  });
});

// ---------------------------------------------------------------------------
// #252 — Print Waypoint Names checkbox + map-opacity slider added to modal.
// ---------------------------------------------------------------------------
test.describe('#252 — Print Waypoint Names + Map Opacity in export modal', () => {
  test('export modal includes print checkboxes, "Waypoint Names" defaults on', async ({ page }) => {
    await boot(page);
    await page.evaluate(wps => {
      state.waypoints = wps;
      syncLegs(); draw();
    }, pairLLHZ_LLHA());
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();

    const checkboxLabels = page.locator('.modal label:has(input[type="checkbox"])');
    expect(await checkboxLabels.count()).toBe(5);
    const labelText = await checkboxLabels.allTextContents();
    expect(labelText).toEqual(expect.arrayContaining([
      expect.stringMatching(/waypoint names/i),
      expect.stringMatching(/cumulative time/i),
      expect.stringMatching(/navigation waypoints/i),
      expect.stringMatching(/airfields/i),
      expect.stringMatching(/flight plan/i),
    ]));

    await expect(page.locator('.modal label:has(input[type="checkbox"])', {
      hasText: /waypoint names/i,
    }).locator('input')).toBeChecked();
    await expect(page.locator('.modal label:has(input[type="checkbox"])', {
      hasText: /cumulative time/i,
    }).locator('input')).toBeChecked();
  });

  test('export modal includes a map-opacity slider', async ({ page }) => {
    await boot(page);
    await page.evaluate(wps => {
      state.waypoints = wps;
      syncLegs(); draw();
    }, pairLLHZ_LLHA());
    await page.locator('#print').click();
    await page.locator('.modal-back').waitFor();

    const ranges = page.locator('.modal input[type="range"]');
    expect(await ranges.count()).toBeGreaterThanOrEqual(1);
    const opacity = ranges.first();
    await expect(opacity).toHaveAttribute('min', '10');
    await expect(opacity).toHaveAttribute('max', '100');
    await expect(opacity).toHaveAttribute('step', '5');
    await expect(opacity).toHaveValue('80');
  });

  test.describe('#367 toolbar horizontal scroll', () => {
    test.beforeEach(async ({ page }) => {
      await boot(page);
      // Expand all toolbar sections so every label is visible.
      for (const s of ['build','view','display','charts','export','print']) {
        await page.evaluate((sec) => {
          const el = document.querySelector(`[data-sec="${sec}"] .tb-section-head`);
          if (el && el.parentElement.dataset.open !== '1') el.click();
        }, s);
      }
    });

    test('English page has no horizontal scrollbar', async ({ page }) => {
      const noHScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth
      );
      expect(noHScroll).toBe(true);
    });
  });
});
