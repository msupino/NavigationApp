// @ts-check
// Rows a held spot on the chart shows, on known points too, and after a language switch.
const { test, expect } = require('./_setup');

const rows = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#inspector:not(.hidden) #insp-body .row label')].map(l => l.textContent));

test.beforeEach(async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showInspector === 'function' && typeof findNavWpToken === 'function'
    && Array.isArray(window.airfields) && airfields.length);
});

// Asked: "add nearest field to known wp, like unknown ones". Same place: under Position.
test('a chart point and a route waypoint show the nearest field under Position', async ({ page }) => {
  await page.evaluate(async () => {
    if (navWP === null) await loadNavWaypoints();
    state.waypoints = []; state.legs = []; draw();
    state.selected = { type: 'navwp', index: navWP.findIndex(n => n.name === 'ZYAAR') };
    showInspector();
  });
  let got = await rows(page);
  expect(got[got.indexOf('Position') + 1]).toBe('Nearest field');

  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.40, lng: 34.95, name: 'A' }, { lat: 32.60, lng: 35.05, name: 'B' }];
    state.legs = [{}]; draw();
    state.selected = { type: 'wp', index: 0 };
    showInspector();
  });
  got = await rows(page);
  expect(got[got.indexOf('Position') + 1]).toBe('Nearest field');
});

test('a waypoint on a field has its airfield panel, not a nearest-field row', async ({ page }) => {
  await page.evaluate(() => {
    const hz = airfields.find(a => a.name === 'LLHZ');
    state.waypoints = [{ lat: hz.lat, lng: hz.lng, name: 'LLHZ' }, { lat: 32.60, lng: 35.05, name: 'B' }];
    state.legs = [{}]; draw();
    state.selected = { type: 'wp', index: 0 };
    showInspector();
  });
  expect(await rows(page)).not.toContain('Nearest field');
});

// Reported: switching language with the inspector open lost Highest terrain. The switch is a
// reload; the panel came back before terrain.json had been read, and was never drawn again.
test('Highest terrain is back after a language switch, however late the terrain arrives', async ({ page }) => {
  await page.waitForFunction(() => typeof terrainHasCoverage === 'function' && terrainHasCoverage());
  await page.evaluate(() => { state.selected = { type: 'coord', lat: 32.1267, lng: 34.83, held: true }; showInspector(); });
  expect(await rows(page)).toContain('Highest terrain');
  await page.route('**/data/terrain.json*', async (r) => { await new Promise(x => setTimeout(x, 1500)); await r.continue(); });
  await page.evaluate(() => window.navSwitchLanguage('he'));
  await page.waitForFunction(() => window.__navLang === 'he' && typeof terrainHasCoverage === 'function' && terrainHasCoverage());
  await expect.poll(() => rows(page)).toContain('התבליט הגבוה');
});
