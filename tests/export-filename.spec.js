// @ts-check
// Exported files are named for their route (dep-to-dest), mirroring the
// saved-route naming (defaultSavedRouteName) instead of a bare "route-".
// routeFileSlug() derives the endpoint slug; every per-route download
// (save/GPX/PLN/FDR/CSV/PNG/KML) leads its filename with it.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof state !== 'undefined' && typeof routeFileSlug === 'function'
    && typeof save === 'function');
}

async function setRoute(page, wps) {
  await page.evaluate((w) => {
    state.waypoints = w;
    if (typeof syncLegs === 'function') syncLegs();
    draw();
  }, wps);
}

test.describe('meaningful export filenames', () => {
  test('routeFileSlug names the file for the endpoints', async ({ page }) => {
    await boot(page);
    await setRoute(page, [
      { lat: 32.45, lng: 35.05, name: 'LLHA' },
      { lat: 32.20, lng: 34.90, name: '' },
      { lat: 32.98, lng: 35.57, name: 'LLIB' },
    ]);
    expect(await page.evaluate(() => routeFileSlug())).toBe('LLHA-to-LLIB');
  });

  test('a saved route downloads as <dep>-to-<dest>-<stamp>.json', async ({ page }) => {
    await boot(page);
    await setRoute(page, [
      { lat: 32.45, lng: 35.05, name: 'LLHA' },
      { lat: 32.98, lng: 35.57, name: 'LLIB' },
    ]);
    const dl = page.waitForEvent('download');
    await page.evaluate(() => save());
    const name = (await dl).suggestedFilename();
    expect(name).toMatch(/^LLHA-to-LLIB-\d{8}-\d{6}\.json$/);
  });

  test('unnamed endpoints fall back to "route"', async ({ page }) => {
    await boot(page);
    await setRoute(page, [
      { lat: 32.45, lng: 35.05, name: '' },
      { lat: 32.98, lng: 35.57, name: '' },
    ]);
    expect(await page.evaluate(() => routeFileSlug())).toBe('route');
  });

  test('endpoint names are sanitised to a filesafe slug', async ({ page }) => {
    await boot(page);
    // Spaces / punctuation collapse to single dashes; no slashes or spaces leak
    // into the download name.
    // Synthetic names (not in any dataset) so navName passes them through.
    await setRoute(page, [
      { lat: 32.45, lng: 35.05, name: 'Foo Bar' },
      { lat: 32.98, lng: 35.57, name: 'Baz/Qux' },
    ]);
    const slug = await page.evaluate(() => routeFileSlug());
    expect(slug).toBe('Foo-Bar-to-Baz-Qux');
    expect(slug).not.toMatch(/[/\s]/);
  });
});
