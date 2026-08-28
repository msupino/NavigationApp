// @ts-check
// A touch tablet keeps the floating toolbar even when its viewport is wider than the
// phone breakpoint. In Hebrew, expanding the menu must not swap its default anchor from
// the right edge to the left edge.
const { test, expect } = require('./_setup');

test.use({
  viewport: { width: 820, height: 1180 },
  hasTouch: true,
  isMobile: true,
});

test('the Hebrew toolbar stays right-anchored when it expands on a touch tablet', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('navaid.toolbarCollapsed', '1');
    localStorage.removeItem('navaid.toolbarPos.he');
  });
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => {
    const toolbar = document.getElementById('toolbar');
    return toolbar && toolbar.classList.contains('collapsed');
  });

  const before = await page.locator('#toolbar').boundingBox();
  expect(before).not.toBeNull();
  const beforeRightInset = 820 - before.x - before.width;

  await page.locator('#toolbar-toggle').click();
  await expect(page.locator('#toolbar')).not.toHaveClass(/collapsed/);
  const after = await page.locator('#toolbar').boundingBox();
  expect(after).not.toBeNull();
  const afterRightInset = 820 - after.x - after.width;

  expect(beforeRightInset).toBeLessThanOrEqual(16);
  expect(Math.abs(afterRightInset - beforeRightInset)).toBeLessThanOrEqual(1);
});
