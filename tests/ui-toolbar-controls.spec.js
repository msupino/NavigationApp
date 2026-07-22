// @ts-check
// Coverage for toolbar UI controls whose state must persist across reload.
// Targets gaps in the existing spec suite: section headers, display checkboxes,
// sliders, base-map layer, and toolbar collapse state.
const { test, expect } = require('./_setup');

async function boot(page) {
  // Guard: run only on the FIRST goto so subsequent reloads keep whatever
  // the test wrote between actions. Other specs use the same pattern.
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_tb_init') !== '1') {
        localStorage.clear();
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_tb_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined');
}

test.describe('Toolbar section toggles', () => {
  test('clicking a section header collapses it and writes navaid.sec.<name>=0', async ({ page }) => {
    await boot(page);
    // Display section starts open (seeded above). Click its header to collapse.
    const header = page.locator('.tb-section[data-sec="display"] .tb-section-head');
    await header.click();
    const stored = await page.evaluate(() => localStorage.getItem('navaid.sec.display'));
    expect(stored).toBe('0');
  });

  test('collapsed state persists across reload', async ({ page }) => {
    await boot(page);
    await page.locator('.tb-section[data-sec="display"] .tb-section-head').click();
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined');
    const stored = await page.evaluate(() => localStorage.getItem('navaid.sec.display'));
    expect(stored).toBe('0');
    await expect(page.locator('.tb-section[data-sec="display"]')).not.toHaveClass(/open/);
  });
});

test.describe('Display checkbox toggles', () => {
  const cases = [
    { id: '#ret-cb',      key: 'navaid.showReturn',     startsChecked: false },
    { id: '#mid-cb',      key: 'navaid.showMidLeg',     startsChecked: false },
    { id: '#diff-cb',     key: 'navaid.highlightDiff',  startsChecked: false },
    { id: '#limit-kites-cb', key: 'navaid.limitLegKites', startsChecked: true },
    { id: '#drift-cb',    key: 'navaid.showDrift',      startsChecked: true  },
    { id: '#navwp-cb',    key: 'navaid.showNavWP',      startsChecked: true  },
    { id: '#airfield-cb', key: 'navaid.showAirfields',  startsChecked: true  },
  ];
  for (const c of cases) {
    test(`${c.id}: toggle writes ${c.key} to localStorage`, async ({ page }) => {
      await boot(page);
      const cb = page.locator(c.id);
      const before = await cb.isChecked();
      expect(before).toBe(c.startsChecked);
      await cb.click();
      const stored = await page.evaluate(k => localStorage.getItem(k), c.key);
      expect(stored).toBe(c.startsChecked ? '0' : '1');
    });
  }
});

test.describe('Map legend', () => {
  test('floats over the map (not in the toolbar) with airfield, waypoint, freq-change symbols', async ({ page }) => {
    await boot(page);
    const legend = page.locator('#map-legend');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText('Legend');
    await expect(legend).toContainText('Airfield');
    await expect(legend).toContainText('Waypoint');
    await expect(legend).toContainText('Freq change');
    await expect(legend.locator('.legend-airfield')).toBeVisible();
    await expect(legend.locator('.legend-waypoint')).toBeVisible();
    await expect(legend.locator('.legend-atc')).toBeVisible();
    // #526: lifted out of the View menu into a top-right Leaflet control on
    // the map, so it reads as a chart legend rather than a menu item.
    const placement = await page.evaluate(() => {
      const el = document.getElementById('map-legend');
      return {
        inMap: !!(el && el.closest('#map')),
        inToolbar: !!(el && el.closest('#toolbar')),
        inLeafletControl: !!(el && el.closest('.leaflet-control')),
      };
    });
    expect(placement).toEqual({ inMap: true, inToolbar: false, inLeafletControl: true });
  });
});

test.describe('Sliders persist to localStorage', () => {
  test('theme toggle button writes navaid.theme and persists across reload', async ({ page }) => {
    await boot(page);
    const btn = page.locator('#theme-toggle');
    // Light by default → button offers to switch TO dark.
    await expect(page.locator('body')).toHaveClass(/theme-light/);
    await expect(btn).toContainText('Dark mode');
    await btn.click();
    expect(await page.evaluate(() => localStorage.getItem('navaid.theme'))).toBe('dark');
    await expect(page.locator('body')).not.toHaveClass(/theme-light/);
    // Now in dark → button offers to switch back TO light.
    await expect(btn).toContainText('Light mode');

    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined');
    await expect(page.locator('body')).not.toHaveClass(/theme-light/);
    await expect(page.locator('#theme-toggle')).toContainText('Light mode');

    await page.locator('#theme-toggle').click();
    expect(await page.evaluate(() => localStorage.getItem('navaid.theme'))).toBe('light');
    await expect(page.locator('body')).toHaveClass(/theme-light/);
  });

  test('clear store wipes all navaid.* keys and reloads', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      localStorage.setItem('navaid.theme', 'light');
      localStorage.setItem('navaid.routes', '[{"id":"x"}]');
      localStorage.setItem('navaid.layer', 'Satellite');
      localStorage.setItem('keepme', '1');           // non-navaid key survives
    });
    page.once('dialog', d => d.accept());
    await page.locator('#clear-store').click();
    await page.waitForFunction(() => typeof state !== 'undefined');  // reloaded
    // Note: the test harness re-seeds navaid.sec.* on every load, so assert the
    // keys we set are gone rather than the whole namespace being empty.
    const after = await page.evaluate(() => ({
      routes: localStorage.getItem('navaid.routes'),
      layer: localStorage.getItem('navaid.layer'),
      theme: localStorage.getItem('navaid.theme'),
      keepme: localStorage.getItem('keepme'),
    }));
    expect(after.routes).toBeNull();
    expect(after.layer).toBeNull();
    expect(after.theme).toBeNull();
    expect(after.keepme).toBe('1');
  });

  test('map opacity defaults to 80% and ignores the legacy storage key', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#map-opacity')).toHaveValue('80');
    await expect(page.locator('#map-opacity-val')).toHaveText('80%');
    await page.evaluate(() => {
      localStorage.setItem('navaid.mapOpacity', '0.25');
      localStorage.removeItem('navaid.mapOpacity.v2');
    });
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined');
    await expect(page.locator('#map-opacity')).toHaveValue('80');
    await expect(page.locator('#map-opacity-val')).toHaveText('80%');
  });

  test('map opacity slider writes navaid.mapOpacity.v2', async ({ page }) => {
    await boot(page);
    await page.locator('#map-opacity').fill('50');
    await page.locator('#map-opacity').dispatchEvent('input');
    const stored = await page.evaluate(() => localStorage.getItem('navaid.mapOpacity.v2'));
    expect(parseFloat(stored)).toBeCloseTo(0.5, 2);
  });

  test('wp-size slider writes navaid.wpSize', async ({ page }) => {
    await boot(page);
    await page.locator('#wp-size').fill('0.5');
    await page.locator('#wp-size').dispatchEvent('input');
    const stored = await page.evaluate(() => localStorage.getItem('navaid.wpSize'));
    expect(parseFloat(stored)).toBeCloseTo(0.5, 1);
  });

  test('leg-arrow-size slider writes navaid.legArrowSize', async ({ page }) => {
    await boot(page);
    await page.locator('#leg-arrow-size').fill('1.7');
    await page.locator('#leg-arrow-size').dispatchEvent('input');
    const stored = await page.evaluate(() => localStorage.getItem('navaid.legArrowSize'));
    expect(parseFloat(stored)).toBeCloseTo(1.7, 1);
  });

  test('sliders restore their stored value on reload', async ({ page }) => {
    await boot(page);
    await page.locator('#wp-size').fill('0.5');
    await page.locator('#wp-size').dispatchEvent('input');
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined');
    expect(await page.locator('#wp-size').inputValue()).toBe('0.5');
  });

  test('slider min/max/step set from JS constants', async ({ page }) => {
    await boot(page);
    const wp = page.locator('#wp-size');
    expect(await wp.getAttribute('min')).toBe('0.1');
    expect(await wp.getAttribute('max')).toBe('2');
    expect(await wp.getAttribute('step')).toBe('0.1');
    const la = page.locator('#leg-arrow-size');
    expect(await la.getAttribute('min')).toBe('1');
    expect(await la.getAttribute('max')).toBe('3');
    expect(await la.getAttribute('step')).toBe('0.1');
  });

  test('percentage sliders show % in value display', async ({ page }) => {
    await boot(page);
    const av = page.locator('#yellow-alpha-val');
    expect(await av.textContent()).toMatch(/^\d+%$/);
    await page.locator('#yellow-alpha').fill('50');
    await page.locator('#yellow-alpha').dispatchEvent('input');
    expect(await av.textContent()).toBe('50%');
  });

  test('kite opacity and label opacity are separate sliders', async ({ page }) => {
    await boot(page);
    // Both sliders present with their own value read-outs.
    await expect(page.locator('#kite-alpha')).toHaveCount(1);
    await expect(page.locator('#yellow-alpha')).toHaveCount(1);
    // Move only the kite slider; the label-opacity global must not change.
    const yellowBefore = await page.evaluate(() => window.yellowAlpha);
    await page.locator('#kite-alpha').fill('30');
    await page.locator('#kite-alpha').dispatchEvent('input');
    expect(await page.evaluate(() => window.kiteAlpha)).toBeCloseTo(0.3, 5);
    expect(await page.evaluate(() => window.yellowAlpha)).toBe(yellowBefore);
    // …and vice-versa.
    const kiteBefore = await page.evaluate(() => window.kiteAlpha);
    await page.locator('#yellow-alpha').fill('60');
    await page.locator('#yellow-alpha').dispatchEvent('input');
    expect(await page.evaluate(() => window.yellowAlpha)).toBeCloseTo(0.6, 5);
    expect(await page.evaluate(() => window.kiteAlpha)).toBe(kiteBefore);
  });

  test('decimal sliders show toFixed(2) in value display', async ({ page }) => {
    await boot(page);
    const wv = page.locator('#wp-size-val');
    expect(await wv.textContent()).toMatch(/^\d+\.\d{2}$/);
    await page.locator('#wp-size').fill('0.5');
    await page.locator('#wp-size').dispatchEvent('input');
    expect(await wv.textContent()).toBe('0.50');
  });
});

test.describe('Layer selector', () => {
  test('changing layer writes navaid.layer and persists across reload', async ({ page }) => {
    await boot(page);
    const sel = page.locator('#layer-select');
    const opts = await sel.locator('option').allTextContents();
    // Pick the second non-default option to exercise the change.
    const target = opts.find(o => o && o !== 'CVFR') || opts[1];
    await sel.selectOption({ label: target });
    const stored = await page.evaluate(() => localStorage.getItem('navaid.layer'));
    expect(stored).toBeTruthy();

    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined');
    const reloaded = await page.evaluate(() => localStorage.getItem('navaid.layer'));
    expect(reloaded).toBe(stored);
  });
});

test.describe('Toolbar collapse on mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('hamburger expands/collapses the floating toolbar and persists navaid.toolbarCollapsed', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#toolbar')).toHaveClass(/collapsed/);

    await page.locator('#toolbar-toggle').click();
    await expect(page.locator('#toolbar')).not.toHaveClass(/collapsed/);
    let stored = await page.evaluate(() => localStorage.getItem('navaid.toolbarCollapsed'));
    expect(stored).toBe('0');

    await page.locator('#toolbar-toggle').click();
    await expect(page.locator('#toolbar')).toHaveClass(/collapsed/);
    stored = await page.evaluate(() => localStorage.getItem('navaid.toolbarCollapsed'));
    expect(stored).toBe('1');

    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined');
    await expect(page.locator('#toolbar')).toHaveClass(/collapsed/);
    const reloaded = await page.evaluate(() => localStorage.getItem('navaid.toolbarCollapsed'));
    expect(reloaded).toBe('1');
  });

  test('expanded mobile toolbar persists across reload', async ({ page }) => {
    await boot(page);
    await page.locator('#toolbar-toggle').click();
    const stored = await page.evaluate(() => localStorage.getItem('navaid.toolbarCollapsed'));
    expect(stored).toBe('0');

    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined');
    await expect(page.locator('#toolbar')).not.toHaveClass(/collapsed/);
  });
});
