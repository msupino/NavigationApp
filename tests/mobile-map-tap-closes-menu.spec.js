// @ts-check
// On a phone, tapping the map closes the toolbar menu -- BOTH levels: the open section
// (sub-menu) and the expanded toolbar column (main menu) that covers half the map. The
// close was wired only to a document 'click', which Leaflet swallows on touch (it handles
// the tap itself and re-fires it as the map's own 'click' rather than letting a native
// click reach document). The fix hooks that map 'click'.
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 390, height: 780 } });   // phone width -> mobile toolbar

async function mobileBoot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof map !== 'undefined');
  expect(await page.evaluate(() => toolbarUsesDesktopMenu())).toBe(false);
}

// A real tap reaches the app as the map's OWN Leaflet 'click' event -- Leaflet handles the
// touch and re-fires it, it does not let a native DOM click bubble to document. Fire that
// Leaflet event directly (with a full payload so Leaflet's own click handlers are happy).
// A DOM click on the container would instead bubble to document and be caught by the
// pre-existing document-'click' listener, which is exactly the path that fails on touch --
// so it would not isolate this fix.
async function tapMap(page) {
  await page.evaluate(() => {
    const pt = map.getSize().divideBy(2);
    map.fire('click', {
      latlng: map.containerPointToLatLng(pt),
      containerPoint: pt,
      layerPoint: map.containerPointToLayerPoint(pt),
      originalEvent: new MouseEvent('click'),
    });
  });
}

test('a map tap closes an open section (sub-menu)', async ({ page }) => {
  await mobileBoot(page);
  await page.evaluate(() => document.querySelector('.tb-section[data-sec="charts"]').classList.add('open'));
  await expect(page.locator('.tb-section[data-sec="charts"]')).toHaveClass(/open/);
  await tapMap(page);
  await expect(page.locator('.tb-section[data-sec="charts"]')).not.toHaveClass(/open/);
});

test('a map tap collapses the expanded toolbar (main menu)', async ({ page }) => {
  await mobileBoot(page);
  await page.evaluate(() => {
    // Isolate THIS hook: a first tap on an empty route arms add-mode, and setMode already
    // collapses the column on mobile. Disarm that so only a plain look-tap is under test --
    // the case the user hit, where a menu stays open over an existing route.
    window.routePrimingArmed = () => false;
    if (typeof state !== 'undefined') state.mode = null;
    // Expand the main column: the state the user is in when a menu is open.
    document.getElementById('toolbar').classList.remove('collapsed');
  });
  await expect(page.locator('#toolbar')).not.toHaveClass(/collapsed/);
  await tapMap(page);
  await expect(page.locator('#toolbar')).toHaveClass(/collapsed/);
});
