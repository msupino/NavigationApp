// @ts-check
// On a phone, focusing a text field raises the on-screen keyboard, which covers the panel just
// opened. Reported on Saved routes: opening it to load a route brought the keyboard up over the
// list. focusForTyping() (ui.js) focuses only where that costs nothing -- a mouse/keyboard device
// -- or where the dialog exists to be typed into (rename, codes, search).
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showRouteLibraryModal === 'function'
    && typeof focusForTyping === 'function' && typeof syncLegs === 'function'
    && !!(window.NavAid && NavAid.assistant));
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'A' }, { lat: 32.98, lng: 35.57, name: 'B' }];
    syncLegs();
  });
}
const activeIsText = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /^(text|search|)$/.test(a.type)));
});

test.describe('touch-only device', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('Saved routes opens without raising the keyboard', async ({ page }) => {
    await boot(page);
    expect(await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches)).toBe(true);
    await page.evaluate(() => showRouteLibraryModal());
    await expect(page.locator('.route-library-name')).toBeVisible();
    expect(await activeIsText(page)).toBe(false);
  });

  test('Save on an unsaved route fills the name but leaves the keyboard down', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => showRouteLibraryModal(true));
    const name = page.locator('.route-library-name');
    await expect(name).not.toHaveValue('');            // the suggestion is there to accept
    await page.waitForTimeout(50);                      // past the deferred focus
    expect(await activeIsText(page)).toBe(false);
  });

  test('the assistant opens without raising the keyboard', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => NavAid.assistant.open());
    expect(await activeIsText(page)).toBe(false);
  });

  test('a dialog that exists to be typed into still focuses its field', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const el = document.createElement('input');
      document.body.appendChild(el);
      const plain = focusForTyping(el);
      const typing = focusForTyping(el, { typingIsThePoint: true });
      const focused = document.activeElement === el;
      el.remove();
      return { plain, typing, focused };
    });
    expect(r).toEqual({ plain: false, typing: true, focused: true });
  });
});

test.describe('mouse and keyboard', () => {
  test('Saved routes still focuses the name for fast typing', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => showRouteLibraryModal());
    await expect(page.locator('.route-library-name')).toBeFocused();
  });
});
