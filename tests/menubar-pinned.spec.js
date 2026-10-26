// @ts-check
// The gist's `featureMenubarDrag` off (the default) pins the desktop top menu: no grip to drag it
// by, and a position saved by an earlier drag is not applied. On, the grip and the saved spot return.
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 1280, height: 800 } });

test('featureMenubarDrag off pins the top menu in place', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.toolbarPosDesktop.en', JSON.stringify({ x: 300, y: 200 })); } catch (e) { /* */ }
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof window.refreshMenubarPin === 'function'
    && typeof toolbarUsesDesktopMenu === 'function' && toolbarUsesDesktopMenu());
  const handle = page.locator('#toolbar-handle');
  // Pinned out of the box.
  await expect(handle).toBeHidden();
  await expect(page.locator('#toolbar')).toHaveClass(/menubar-pinned/);
  const flip = (on) => page.evaluate((v) => { NavAid.tuning.featureMenubarDrag = v; window.refreshMenubarPin(); }, on);
  await flip(true);
  await expect(handle).toBeVisible();
  expect(await page.evaluate(() => document.getElementById('toolbar').style.left)).not.toBe('');

  await flip(false);
  await expect(page.locator('#toolbar')).toHaveClass(/menubar-pinned/);
  await expect(handle).toBeHidden();
  expect(await page.evaluate(() => document.getElementById('toolbar').style.left)).toBe('');
  const home = await page.locator('#toolbar').boundingBox();

  await flip(true);
  await expect(handle).toBeVisible();
  await expect(page.locator('#toolbar')).not.toHaveClass(/menubar-pinned/);
  // Dragging works again.
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 120, hb.y + 160, { steps: 4 });
  await page.mouse.up();
  const moved = await page.locator('#toolbar').boundingBox();
  expect(Math.abs(moved.y - home.y)).toBeGreaterThan(40);
});
