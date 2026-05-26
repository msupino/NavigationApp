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
  await page.goto('/?lang=en');
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

test.describe('Sliders persist to localStorage', () => {
  test('map opacity slider writes navaid.mapOpacity', async ({ page }) => {
    await boot(page);
    await page.locator('#map-opacity').fill('50');
    await page.locator('#map-opacity').dispatchEvent('input');
    const stored = await page.evaluate(() => localStorage.getItem('navaid.mapOpacity'));
    expect(parseFloat(stored)).toBeCloseTo(0.5, 2);
  });

  test('wp-size slider writes navaid.wpSize', async ({ page }) => {
    await boot(page);
    await page.locator('#wp-size').fill('1.5');
    await page.locator('#wp-size').dispatchEvent('input');
    const stored = await page.evaluate(() => localStorage.getItem('navaid.wpSize'));
    expect(parseFloat(stored)).toBeCloseTo(1.5, 1);
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
    await page.locator('#wp-size').fill('1.3');
    await page.locator('#wp-size').dispatchEvent('input');
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined');
    expect(await page.locator('#wp-size').inputValue()).toBe('1.3');
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

test.describe('Toolbar collapse', () => {
  test('hamburger toggles toolbar visibility and persists navaid.toolbarCollapsed', async ({ page }) => {
    await boot(page);
    await page.locator('#toolbar-toggle').click();
    const stored = await page.evaluate(() => localStorage.getItem('navaid.toolbarCollapsed'));
    expect(stored).toBe('1');

    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined');
    const reloaded = await page.evaluate(() => localStorage.getItem('navaid.toolbarCollapsed'));
    expect(reloaded).toBe('1');
  });

  test('clicking hamburger again expands the toolbar', async ({ page }) => {
    await boot(page);
    await page.locator('#toolbar-toggle').click();
    await page.locator('#toolbar-toggle').click();
    const stored = await page.evaluate(() => localStorage.getItem('navaid.toolbarCollapsed'));
    expect(stored === null || stored === '0').toBeTruthy();
  });
});

test.describe('Tooltip icons (tip-icon)', () => {
  test('tip-icon appears next to labels with tooltips', async ({ page }) => {
    await boot(page);
    const icons = page.locator('.tip-icon');
    const count = await icons.count();
    // Should be at least one per checkbox/button in the toolbar.
    expect(count).toBeGreaterThan(5);
  });

  test('clicking tip-icon shows a popup with tooltip text', async ({ page }) => {
    await boot(page);
    const first = page.locator('.tip-icon').first();
    await first.click();
    const popup = page.locator('.tip-popup');
    await expect(popup).toBeVisible();
    const text = await popup.textContent();
    expect(text.length).toBeGreaterThan(0);
  });

  test('tip-icon click does not toggle the parent checkbox', async ({ page }) => {
    await boot(page);
    // Find a label that has both a checkbox and a tip-icon.
    const label = page.locator('.navtoggle').filter({ has: page.locator('.tip-icon') }).first();
    const checkbox = label.locator('input[type="checkbox"]');
    const before = await checkbox.isChecked();
    await label.locator('.tip-icon').click();
    expect(await checkbox.isChecked()).toBe(before);
  });

  test('clicking outside dismisses the popup', async ({ page }) => {
    await boot(page);
    const first = page.locator('.tip-icon').first();
    await first.click();
    const popup = page.locator('.tip-popup');
    await expect(popup).toBeVisible();
    // Click the map area to dismiss.
    await page.locator('#map').click({ position: { x: 10, y: 10 } });
    await expect(popup).toHaveCount(0);
  });
});


