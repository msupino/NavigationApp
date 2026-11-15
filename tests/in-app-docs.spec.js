// @ts-check
// Reported: on a phone (the installed app), About / Terms / Privacy from the menu opened with no
// close button, and Back restarted the app -- the page had replaced NavAid in its web view. In
// the app they open in a window over the map with a close X, and Back closes that window. On
// the web the links still open a new tab.
const { test, expect } = require('./_setup');

async function boot(page, native) {
  await page.addInitScript((native) => {
    window.__backHandlers = [];
    window.__exited = 0;
    if (native) window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: { App: {
        addListener: (name, fn) => { if (name === 'backButton') window.__backHandlers.push(fn); },
        exitApp: () => { window.__exited++; },
      } },
    };
  }, native);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof backButtonStep === 'function' && !!document.getElementById('deck-bar'));
  await page.evaluate(() => { document.getElementById('boot-loading')?.remove(); document.documentElement.classList.remove('app-booting'); });
}

for (const [id, file, title] of [['about-link', 'about.html', 'About'], ['privacy-link', 'privacy.html', 'Privacy'], ['terms-link', 'terms.html', 'Terms']]) {
  test(`in the app, ${title} opens in a window with a close X, and Back closes it`, async ({ page }) => {
    await boot(page, true);
    const url = page.url();
    await page.locator('.deck-btn-menu').click();
    await page.locator('#' + id).evaluate((a) => a.click());   // the row in the phone menu
    const win = page.locator('.modal.doc-modal');
    await expect(win).toBeVisible();
    await expect(win.locator('iframe.doc-modal-frame')).toHaveAttribute('src', new RegExp('^' + file.replace('.', '\\.') + '\\?lang=en$'));
    await expect(win.locator('.modal-close-x')).toBeVisible();
    expect(page.url()).toBe(url);                                // NavAid was not replaced
    // Android Back closes the window and does not leave the app.
    await page.evaluate(async () => { await Promise.all(window.__backHandlers.map(fn => fn())); });
    await expect(win).toHaveCount(0);
    expect(await page.evaluate(() => window.__exited)).toBe(0);
  });
}

test('on the web the links still open a new tab', async ({ page, context }) => {
  await boot(page, false);
  await page.locator('.deck-btn-menu').click();
  const [popup] = await Promise.all([context.waitForEvent('page'), page.locator('#about-link').evaluate((a) => a.click())]);
  expect(popup.url()).toMatch(/about\.html/);
  await expect(page.locator('.modal.doc-modal')).toHaveCount(0);
});
