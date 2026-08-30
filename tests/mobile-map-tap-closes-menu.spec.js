// @ts-check
// On a phone, tapping the map closes an open toolbar menu. The document 'click' listener
// that handles taps outside the toolbar is unreliable on touch -- Leaflet synthesises the
// map tap and the native click never reaches document -- so the close is also wired to
// Leaflet's own map 'mousedown', which fires from the container's real DOM event.
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 390, height: 780 } });   // phone width -> mobile toolbar

test('tapping the map closes an open toolbar section on mobile', async ({ page }) => {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof map !== 'undefined');
  expect(await page.evaluate(() => toolbarUsesDesktopMenu())).toBe(false);

  await page.evaluate(() => document.querySelector('.tb-section[data-sec="charts"]').classList.add('open'));
  await expect(page.locator('.tb-section[data-sec="charts"]')).toHaveClass(/open/);

  // A real press on the map: dispatch the container's DOM mousedown low on the screen,
  // clear of the toolbar. Leaflet turns this into its map 'mousedown' -- the event the fix
  // hooks -- with a proper containerPoint, so its own drag machinery is happy too.
  await page.evaluate(() => {
    const c = map.getContainer();
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, view: window,
      clientX: r.left + r.width / 2, clientY: r.top + r.height - 40,
    }));
  });

  await expect(page.locator('.tb-section[data-sec="charts"]')).not.toHaveClass(/open/);
});
