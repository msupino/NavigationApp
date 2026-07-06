// A corrupt saved-route library (unparseable / non-array navaid.routes) must
// not be treated as empty: save / import / GPS-save would persist [] over it
// and silently erase the raw data. Mirror the main route store's #73 guard —
// preserve the raw blob, flag it, and block writes until export or discard.
const { test, expect } = require('./_setup');

async function bootCorrupt(page, blob = '{bad json') {
  await page.addInitScript((b) => {
    try {
      localStorage.setItem('navaid.routes', b);
      localStorage.removeItem('navaid.route');
    } catch (e) {}
  }, blob);
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof loadRouteLibrary === 'function' && typeof persistRouteLibrary === 'function' &&
    typeof routeLibrarySaveCurrent === 'function');
}

test.describe('corrupt saved-route library', () => {
  test('detected, flagged, raw preserved, and writes blocked', async ({ page }) => {
    await bootCorrupt(page);
    page.on('dialog', d => d.accept());
    const r = await page.evaluate(() => {
      const parsed = loadRouteLibrary();
      const flag = NavAid.routeLibraryCorrupt;
      const wrote = persistRouteLibrary([{ id: 'x', name: 'n', savedAt: '2026', data: {} }]);
      return { parsedLen: parsed.length, flag, wrote, rawAfter: localStorage.getItem('navaid.routes') };
    });
    expect(r.parsedLen).toBe(0);
    expect(r.flag).toBe(true);
    expect(r.wrote).toBe(false);
    expect(r.rawAfter).toBe('{bad json');   // raw blob untouched
  });

  test('a non-array blob is also treated as corrupt', async ({ page }) => {
    await bootCorrupt(page, '{"not":"an array"}');
    const r = await page.evaluate(() => {
      const parsed = loadRouteLibrary();
      return { len: parsed.length, flag: NavAid.routeLibraryCorrupt };
    });
    expect(r.len).toBe(0);
    expect(r.flag).toBe(true);
  });

  test('save on a corrupt library refuses and does not erase it', async ({ page }) => {
    await bootCorrupt(page);
    page.on('dialog', d => d.accept());
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32, lng: 34, name: 'A' }, { lat: 33, lng: 35, name: 'B' }];
      state.legs = []; syncLegs();
    });
    const r = await page.evaluate(() => ({
      entry: routeLibrarySaveCurrent('x'),
      raw: localStorage.getItem('navaid.routes'),
    }));
    expect(r.entry).toBeNull();            // save refused
    expect(r.raw).toBe('{bad json');       // preserved
  });

  test('force discard clears the corrupt blob and unblocks writes', async ({ page }) => {
    await bootCorrupt(page);
    const r = await page.evaluate(() => {
      loadRouteLibrary();
      const ok = persistRouteLibrary([], { force: true });
      return { ok, raw: localStorage.getItem('navaid.routes'), flag: NavAid.routeLibraryCorrupt };
    });
    expect(r.ok).toBe(true);
    expect(r.raw).toBe('[]');
    expect(r.flag).toBe(false);
  });

  test('the Saved routes menu shows a recovery banner when corrupt', async ({ page }) => {
    await bootCorrupt(page);
    await page.evaluate(() => showRouteLibraryModal());
    const modal = page.locator('.route-library-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.route-library-corrupt')).toBeVisible();
    await expect(modal.getByRole('button', { name: /discard/i })).toBeVisible();
  });
});
