// @ts-check
// Desktop toolbar layout: wide viewports use a fixed top menubar with
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
    expect(Math.round(box.x)).toBe(0);
    expect(Math.round(box.y)).toBe(0);
    expect(box.width).toBeGreaterThan(1200);
    expect(box.height).toBeLessThanOrEqual(36);
    await expect(toolbar).not.toHaveClass(/collapsed/);
    await expect(page.locator('#toolbar-handle')).toBeHidden();
    await expect(page.locator('#toolbar-toggle')).toBeHidden();

    const mapBox = await page.locator('#map').boundingBox();
    expect(mapBox).not.toBeNull();
    expect(Math.round(mapBox.y)).toBeGreaterThanOrEqual(33);
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
});
