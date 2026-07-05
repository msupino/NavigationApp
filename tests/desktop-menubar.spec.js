// @ts-check
// Desktop toolbar layout: wide viewports use a floating top menubar (a
// rounded bar detached from the screen edges, hovering over the map) with
// dropdown panels, while mobile keeps the floating draggable column.
const { test, expect } = require('./_setup');

async function bootDesktop(page, opts = {}) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(options => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      if (options.collapsed) localStorage.setItem('navaid.toolbarCollapsed', '1');
      if (options.pos) localStorage.setItem('navaid.toolbarPos', JSON.stringify(options.pos));
      for (const sec of options.openSections || []) {
        localStorage.setItem('navaid.sec.' + sec, '1');
      }
    } catch (e) {}
  }, opts);
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined');
}

test.describe('Desktop menubar layout', () => {
  test('uses a top menubar and ignores saved mobile drag/collapse state', async ({ page }) => {
    await bootDesktop(page, { collapsed: true, pos: { x: 220, y: 180 } });

    const toolbar = page.locator('#toolbar');
    const box = await toolbar.boundingBox();
    expect(box).not.toBeNull();
    // Floating bar: detached from the top-left corner, not docked.
    expect(Math.round(box.x)).toBe(12);
    expect(Math.round(box.y)).toBe(12);
    // Content-width, detached from the right edge (not full-width).
    expect(box.width).toBeGreaterThan(400);
    expect(box.width).toBeLessThan(1280 - 12);
    expect(box.height).toBeLessThanOrEqual(36);
    await expect(toolbar).not.toHaveClass(/collapsed/);
    // The drag grip is shown on desktop (the bar is draggable); the
    // collapse toggle stays hidden.
    await expect(page.locator('#toolbar-handle')).toBeVisible();
    await expect(page.locator('#toolbar-toggle')).toBeHidden();

    const mapBox = await page.locator('#map').boundingBox();
    expect(mapBox).not.toBeNull();
    // Map fills the viewport behind the floating bar.
    expect(Math.round(mapBox.y)).toBeLessThanOrEqual(1);
  });

  test('drag grip repositions the floating bar and persists the position', async ({ page }) => {
    await bootDesktop(page);
    const bar = page.locator('#toolbar');
    const grip = page.locator('#toolbar-handle');
    await expect(grip).toBeVisible();
    const before = await bar.boundingBox();
    const g = await grip.boundingBox();
    if (!g || !before) throw new Error('no box');

    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + 220, g.y + 160, { steps: 6 });
    await page.mouse.up();

    const after = await bar.boundingBox();
    if (!after) throw new Error('no box');
    // The bar nearly fills the viewport width, so horizontal drag room is
    // limited (the drag clamps at the right edge); assert it moved rightward
    // and that the large vertical drag lands, plus that it persisted below.
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeGreaterThan(before.y + 90);
    const stored = await page.evaluate(() => localStorage.getItem('navaid.toolbarPosDesktop.en'));
    expect(stored).toBeTruthy();
    const pos = JSON.parse(stored);
    expect(Math.abs(pos.x - after.x)).toBeLessThan(3);
    expect(Math.abs(pos.y - after.y)).toBeLessThan(3);
  });

  test('a saved desktop bar position is restored on load', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => {
      try {
        localStorage.clear(); sessionStorage.clear();
        // Use a position well within the clamp for the (wide) desktop bar so it
        // restores exactly — a larger x would clamp at the right viewport edge.
        localStorage.setItem('navaid.toolbarPosDesktop.en', JSON.stringify({ x: 60, y: 180 }));
      } catch (e) {}
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof state !== 'undefined');
    // Position is re-applied via requestAnimationFrame after load — wait for it.
    await page.waitForFunction(() => {
      const t = document.getElementById('toolbar');
      return !!(t && t.style.left && parseFloat(t.style.left) > 40);
    });
    const box = await page.locator('#toolbar').boundingBox();
    if (!box) throw new Error('no box');
    expect(Math.abs(box.x - 60)).toBeLessThan(4);
    expect(Math.abs(box.y - 180)).toBeLessThan(4);
  });

  test('Hebrew (RTL) floats the bar at the top-right, above the clock', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
    await page.goto('?lang=he');
    await page.waitForFunction(() => typeof state !== 'undefined' && document.getElementById('zulu-clock'));
    const bar = await page.locator('#toolbar').boundingBox();
    if (!bar) throw new Error('no box');
    expect(Math.round(bar.y)).toBe(12);
    // Right-anchored: right edge near the viewport edge, left edge well off 12.
    expect(bar.x + bar.width).toBeGreaterThan(1280 - 20);
    expect(bar.x).toBeGreaterThan(40);   // clearly right-anchored (not the left ~8)
    // Clock sits below the bar.
    const clock = await page.locator('#zulu-clock').boundingBox();
    if (!clock) throw new Error('no box');
    expect(clock.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  });

  test('opens one dropdown at a time and closes from the map or Escape', async ({ page }) => {
    await bootDesktop(page);

    const build = page.locator('.tb-section[data-sec="build"]');
    const view = page.locator('.tb-section[data-sec="view"]');
    await build.locator('.tb-section-head').click();
    await expect(build).toHaveClass(/open/);
    await expect(build.locator('.tb-section-body')).toBeVisible();
    let menuBox = await build.locator('.tb-section-body').boundingBox();
    const toolbarBox = await page.locator('#toolbar').boundingBox();
    expect(menuBox).not.toBeNull();
    expect(toolbarBox).not.toBeNull();
    expect(menuBox.y).toBeGreaterThanOrEqual(toolbarBox.height - 1);

    await view.locator('.tb-section-head').click();
    await expect(build).not.toHaveClass(/open/);
    await expect(view).toHaveClass(/open/);

    await page.mouse.click(900, 420);
    await expect(view).not.toHaveClass(/open/);

    await build.locator('.tb-section-head').click();
    await expect(build).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(build).not.toHaveClass(/open/);
  });

  test('the menu and its dropdowns render above the inspector', async ({ page }) => {
    await bootDesktop(page, {
      openSections: ['build', 'view', 'display', 'charts', 'export', 'weather', 'sim', 'print'],
    });

    await expect(page.locator('#toolbar')).toHaveClass(/multi-open/);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.0, lng: 34.8, name: 'A' },
        { lat: 32.2, lng: 35.0, name: 'B' },
      ];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
      draw();
    });

    // The menu bar and an open dropdown stack above the inspector — an open
    // menu should cover the inspector, not be hidden behind it.
    const z = await page.evaluate(() => {
      const zi = el => parseInt(getComputedStyle(el).zIndex, 10);
      return {
        bar: zi(document.getElementById('toolbar')),
        dropdown: zi(document.querySelector('.tb-section.open .tb-section-body')),
        inspector: zi(document.getElementById('inspector')),
      };
    });
    expect(z.bar).toBeGreaterThan(z.inspector);
    expect(z.dropdown).toBeGreaterThan(z.inspector);

    // Functional check: where an open dropdown actually overlaps the inspector,
    // the dropdown wins the hit-test.
    const overlapHit = await page.evaluate(() => {
      const insp = document.getElementById('inspector').getBoundingClientRect();
      for (const body of document.querySelectorAll('.tb-section.open .tb-section-body')) {
        const b = body.getBoundingClientRect();
        const l = Math.max(insp.left, b.left), r = Math.min(insp.right, b.right);
        const t = Math.max(insp.top, b.top), bot = Math.min(insp.bottom, b.bottom);
        if (l < r && t < bot) {
          const el = document.elementFromPoint((l + r) / 2, (t + bot) / 2);
          return !!(el && el.closest('#toolbar'));
        }
      }
      return null; // no overlap on this layout — z-index assertions above suffice
    });
    if (overlapHit !== null) expect(overlapHit).toBe(true);
  });

  test('print menu groups page controls and shows orientation text', async ({ page }) => {
    await bootDesktop(page);

    const print = page.locator('.tb-section[data-sec="print"]');
    await print.locator('.tb-section-head').click();
    await expect(print).toHaveClass(/open/);

    const label = print.locator('.tb-print-label');
    await expect(label).toBeVisible();
    await expect(label).toHaveText('Page size');

    const pageButtons = print.locator('#page-buttons');
    await expect(pageButtons.locator('#page-a3')).toBeVisible();
    await expect(pageButtons.locator('#page-a4')).toBeVisible();
    await expect(pageButtons.locator('#page-orient')).toContainText('Portrait');

    const menuBox = await print.locator('.tb-section-body').boundingBox();
    const orientBox = await print.locator('#page-orient').boundingBox();
    const a3Box = await print.locator('#page-a3').boundingBox();
    expect(menuBox).not.toBeNull();
    expect(orientBox).not.toBeNull();
    expect(a3Box).not.toBeNull();
    expect(orientBox.width).toBeGreaterThan(a3Box.width * 1.5);
    expect(orientBox.x).toBeGreaterThanOrEqual(menuBox.x);

    await print.locator('#page-orient').click();
    await expect(print.locator('#page-orient')).toContainText('Landscape');
  });

  test('shows the app version under the legend (menu bar hides it on desktop)', async ({ page }) => {
    await bootDesktop(page);
    // Toolbar version is hidden on desktop...
    await expect(page.locator('#app-version')).toBeHidden();
    // ...and surfaced under the legend instead.
    const lv = page.locator('#legend-version');
    await expect(lv).toBeVisible();
    await expect(lv).toHaveText(/^v\d/);

    // Mobile keeps the version in the toolbar; the legend copy is hidden.
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(page.locator('#legend-version')).toBeHidden();
  });

  test('inspector defaults to the right in English, the left in Hebrew', async ({ page }) => {
    const showWp = () => {
      // eslint-disable-next-line no-undef
      state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'A' }];
      // eslint-disable-next-line no-undef
      state.selected = { type: 'wp', index: 0 };
      // eslint-disable-next-line no-undef
      showInspector();
    };

    // English — right-anchored.
    await bootDesktop(page);
    await page.evaluate(showWp);
    let box = await page.locator('#inspector').boundingBox();
    const vw = 1280;
    if (!box) throw new Error('no box');
    expect(box.x + box.width).toBeGreaterThan(vw - 40);
    expect(box.x).toBeGreaterThan(vw / 2);

    // Hebrew — left-anchored.
    await page.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
    await page.goto('?lang=he');
    await page.waitForFunction(() => typeof state !== 'undefined' && typeof showInspector === 'function');
    await page.evaluate(showWp);
    box = await page.locator('#inspector').boundingBox();
    if (!box) throw new Error('no box');
    expect(box.x).toBeLessThan(40);
  });
});
