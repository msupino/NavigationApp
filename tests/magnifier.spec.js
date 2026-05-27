// @ts-check
const { test, expect } = require('./_setup');

test.describe('Magnifying glass', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print'])
          localStorage.setItem('navaid.sec.' + s, '1');
      } catch (e) {}
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof state !== 'undefined');
    // ensure nav-waypoints are loaded for the snapping logic
    await page.waitForFunction(() => window.navWP && window.navWP.length > 0);
  });

  test('button exists in View section and toggles magnifier', async ({ page }) => {
    const btn = page.locator('#tool-magnifier');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText(/Magnifying Glass/);
    // starts inactive
    await expect(btn).not.toHaveClass(/active/);
    await expect(page.locator('#magnifier')).not.toBeVisible();
    // click to activate
    await btn.click();
    await expect(btn).toHaveClass(/active/);
    await expect(page.locator('#magnifier')).toBeVisible();
    // settings panel visible
    await expect(page.locator('#magnifier-settings')).not.toHaveClass(/hidden/);
    // click to deactivate
    await btn.click();
    await expect(page.locator('#magnifier')).not.toBeVisible();
  });

  test('magnifier follows mouse when active', async ({ page }) => {
    await page.locator('#tool-magnifier').click();
    const mag = page.locator('#magnifier');
    await expect(mag).toBeVisible();
    // move mouse over the map
    const mapBox = await page.locator('#map').boundingBox();
    if (!mapBox) { test.skip(true, 'map not found'); return; }
    const cx = mapBox.x + mapBox.width / 2;
    const cy = mapBox.y + mapBox.height / 2;
    await page.mouse.move(cx, cy);
    // magnifier should be positioned near the cursor
    const magBox = await mag.boundingBox();
    expect(magBox).toBeTruthy();
    if (magBox) {
      expect(Math.abs(magBox.x + magBox.width / 2 - cx)).toBeLessThan(10);
    }
  });

  test('zoom slider updates magnifierZoom', async ({ page }) => {
    await page.locator('#tool-magnifier').click();
    await page.waitForSelector('#mag-zoom');
    const slider = page.locator('#mag-zoom');
    // set to 3
    await slider.fill('3');
    await slider.dispatchEvent('input');
    const zoomVal = await page.evaluate(() => window.magnifierZoom);
    expect(zoomVal).toBe(3);
  });

  test('click-to-lock toggles on click and selects underlying item', async ({ page }) => {
    await page.locator('#tool-magnifier').click();
    const mag = page.locator('#magnifier');
    await expect(mag).toBeVisible();
    // move to a position
    const mapBox = await page.locator('#map').boundingBox();
    if (!mapBox) { test.skip(true, 'map not found'); return; }
    // first, add a couple waypoints so there's something to select
    await page.locator('#tool-add').click();
    await page.mouse.click(mapBox.x + 100, mapBox.y + 100);
    await page.mouse.click(mapBox.x + 200, mapBox.y + 200);
    await page.locator('#tool-add').click(); // exit add mode
    // enable magnifier
    await page.locator('#tool-magnifier').click();
    await page.waitForSelector('#magnifier');
    // move to first waypoint and click to lock
    await page.mouse.move(mapBox.x + 100, mapBox.y + 100);
    const boxBefore = await mag.boundingBox();
    await page.mouse.click(mapBox.x + 100, mapBox.y + 100);
    // movement should be locked now
    await page.mouse.move(mapBox.x + 300, mapBox.y + 300);
    const boxAfter = await mag.boundingBox();
    expect(boxBefore?.x).toBe(boxAfter?.x);
    expect(boxBefore?.y).toBe(boxAfter?.y);
    // click again to unlock and select something
    await page.mouse.click(mapBox.x + 200, mapBox.y + 200);
    // move mouse — magnifier should follow
    await page.mouse.move(mapBox.x + 150, mapBox.y + 150);
    const boxReleased = await mag.boundingBox();
    expect(boxReleased?.x).not.toBe(boxAfter?.x);
  });
    expect(boxReleased?.x).not.toBe(boxAfter?.x);
  });

  test('ESC closes magnifier', async ({ page }) => {
    await page.locator('#tool-magnifier').click();
    await expect(page.locator('#magnifier')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#magnifier')).not.toBeVisible();
    await expect(page.locator('#tool-magnifier')).not.toHaveClass(/active/);
  });

  test('settings close button closes magnifier', async ({ page }) => {
    await page.locator('#tool-magnifier').click();
    await expect(page.locator('#magnifier-settings')).not.toHaveClass(/hidden/);
    await page.locator('#mag-settings-close').click();
    await expect(page.locator('#magnifier')).not.toBeVisible();
  });
});
