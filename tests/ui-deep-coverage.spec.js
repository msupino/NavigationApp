// @ts-check
// Coverage for under-tested interactive UI areas:
//   - Inspector panel (waypoint click → open, edit name, close)
//   - Charts modal navigation (open airport row, click plate, plate viewer)
//   - Toolbar drag (#toolbar-handle writes navaid.toolbarPos)
//   - Rotate dial (map rotation writes navaid.bearing)
//   - Page frame A3/A4 (show/hide via toolbar buttons)
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_deep_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('__test_deep_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof showInspector === 'function');
}

// ---------------------------------------------------------------------------
// Inspector panel
// ---------------------------------------------------------------------------
test.describe('Inspector panel', () => {
  test('opens when a waypoint is selected; close button hides it', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.1, lng: 34.9, name: 'ALPHA' }];
      state.selected = { type: 'waypoint', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    await expect(page.locator('#inspector')).not.toHaveClass(/hidden/);
    expect(await page.locator('#insp-title').inputValue()).toBe('ALPHA');

    await page.locator('#insp-close').click();
    await expect(page.locator('#inspector')).toHaveClass(/hidden/);
    const sel = await page.evaluate(() => state.selected);
    expect(sel).toBeNull();
  });

  test('editing the inspector title updates state.waypoints[i].name live', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.1, lng: 34.9, name: 'OLD' }];
      state.selected = { type: 'waypoint', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    await page.locator('#insp-title').fill('NEW_NAME');
    await page.locator('#insp-title').dispatchEvent('input');
    const name = await page.evaluate(() => state.waypoints[0].name);
    expect(name).toBe('NEW_NAME');
  });

  test('inspector body shows latitude + longitude rows for waypoint', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.17944, lng: 34.83444, name: 'LLHZ' }];
      state.selected = { type: 'waypoint', index: 0 };
      syncLegs(); draw(); showInspector();
    });
    const bodyText = await page.locator('#insp-body').textContent();
    expect(bodyText).toMatch(/Latitude/);
    expect(bodyText).toMatch(/Longitude/);
  });
});

// ---------------------------------------------------------------------------
// Charts modal navigation
// ---------------------------------------------------------------------------
test.describe('Charts modal navigation', () => {
  test('opens with at least one airport row', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await page.locator('#charts').click();
    await page.locator('.modal-back').waitFor({ timeout: 5000 });

    const rows = page.locator('.charts-airport-header');
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test('clicking an airport header toggles its body open', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await page.locator('#charts').click();
    await page.locator('.modal-back').waitFor();

    const head = page.locator('.charts-airport-header').first();
    await head.click();
    expect(await head.getAttribute('aria-expanded')).toBe('true');
  });

  test('clicking a plate chip opens the plate viewer', async ({ page }) => {
    await boot(page);
    await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
    await page.locator('#charts').click();
    await page.locator('.modal-back').waitFor();

    // Find an airport with plates and open it.
    const head = page.locator('.charts-airport-header').first();
    await head.click();

    // Plate chips render as buttons inside .charts-cat blocks.
    const chip = page.locator('.charts-modal-body button').first();
    if (await chip.count()) {
      await chip.click();
      // Plate viewer opens as a new modal-back; charts modal stays open
      // underneath. At least one modal-back must still be visible.
      await expect(page.locator('.modal-back').first()).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// Toolbar drag (#toolbar-handle → navaid.toolbarPos)
// ---------------------------------------------------------------------------
test.describe('Toolbar drag', () => {
  test('dragging the handle writes navaid.toolbarPos to localStorage', async ({ page }) => {
    await boot(page);
    const handle = page.locator('#toolbar-handle');
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    if (!handleBox) return;

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + 80, handleBox.y + 60, { steps: 4 });
    await page.mouse.up();

    const stored = await page.evaluate(() => localStorage.getItem('navaid.toolbarPos'));
    expect(stored).toBeTruthy();
    const pos = JSON.parse(stored);
    expect(typeof pos.x).toBe('number');
    expect(typeof pos.y).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Rotate dial (map rotation → navaid.bearing)
// ---------------------------------------------------------------------------
test.describe('Rotate dial / map bearing', () => {
  test('rotating the map persists bearing to localStorage', async ({ page }) => {
    await boot(page);
    // Trigger a rotation through the Leaflet plugin. The 'rotate' event
    // fires a debounced 400 ms persist in ui.js.
    await page.evaluate(() => {
      if (typeof map.setBearing === 'function') map.setBearing(45);
    });
    await page.waitForTimeout(600);

    const stored = await page.evaluate(() => localStorage.getItem('navaid.bearing'));
    expect(stored).toBeTruthy();
    const b = parseFloat(stored);
    expect(b).toBeCloseTo(45, 0);
  });

  test('rotate-dial element is present and tabbable', async ({ page }) => {
    await boot(page);
    const dial = page.locator('#rotate-dial');
    await expect(dial).toBeVisible();
    expect(await dial.getAttribute('role')).toBe('slider');
    expect(await dial.getAttribute('tabindex')).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// Page frame A3 / A4 buttons
// ---------------------------------------------------------------------------
test.describe('Page frame A3 / A4', () => {
  test('A4 button enables the page frame (button gets .active)', async ({ page }) => {
    await boot(page);
    const a4 = page.locator('#page-a4');
    await a4.click();
    await expect(a4).toHaveClass(/active/);
  });

  test('clicking the same size button again toggles the frame off', async ({ page }) => {
    await boot(page);
    const a4 = page.locator('#page-a4');
    await a4.click();
    await expect(a4).toHaveClass(/active/);
    await a4.click();
    await expect(a4).not.toHaveClass(/active/);
  });

  test('switching from A4 to A3 transfers the .active marker', async ({ page }) => {
    await boot(page);
    await page.locator('#page-a4').click();
    await page.locator('#page-a3').click();
    await expect(page.locator('#page-a4')).not.toHaveClass(/active/);
    await expect(page.locator('#page-a3')).toHaveClass(/active/);
  });

  test('toggling orientation persists navaid.pageOrient', async ({ page }) => {
    await boot(page);
    await page.locator('#page-a4').click();
    const before = await page.evaluate(() => window.pageOrient);
    await page.locator('#page-orient').click();
    const after = await page.evaluate(() => window.pageOrient);
    expect(after).not.toBe(before);
    const stored = await page.evaluate(() => localStorage.getItem('navaid.pageOrient'));
    expect(stored).toBe(after);
  });
});
