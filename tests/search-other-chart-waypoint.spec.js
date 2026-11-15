// @ts-check
// Reported: with the CVFR waypoints in use, typing a waypoint of another chart (ATS) said only
// "Unknown waypoint". Now the search says which chart has it, and the no-match row offers to
// switch "Nav waypoints from" to that chart.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof navWaypointOtherCharts === 'function');
  await page.evaluate(() => loadNavWaypoints());
  await page.waitForFunction(() => Array.isArray(window.navWP) && window.navWP.length > 0);
  await page.evaluate(() => loadAirfields && loadAirfields());
  // A real code of the ATS set that the CVFR set (in use) does not have, and no airfield is.
  return page.evaluate(async () => {
    const d = routeShapeFromGraph('nav-waypoints', await routeGraphData('ats'), 'ats');
    const ats = (Array.isArray(d) ? d : (d.waypoints || d.points || [])).map(w => w.name).filter(Boolean);
    const cvfr = new Set(navWP.map(w => w.name.toUpperCase()));
    return { prefix: layerDataPrefix(),
      code: ats.find(n => /^[A-Z]{4,5}$/.test(n) && !cvfr.has(n) && !findNavWpToken(n)) };
  });
}

test('a route of codes names the chart an unknown code belongs to', async ({ page }) => {
  const { prefix, code } = await boot(page);
  expect(prefix).toBe('cvfr');
  expect(code).toBeTruthy();
  const said = await page.evaluate(async (code) => {
    const toasts = [];
    window.showToast = (m) => toasts.push(m);
    const built = await buildRouteFromQuery('LLHZ ' + code + ' LLIB');
    return { built, toasts, others: await navWaypointOtherCharts(code) };
  }, code);
  expect(said.built).toBe(false);
  expect(said.others).toContain('ats');
  expect(said.toasts).toHaveLength(1);
  expect(said.toasts[0]).toContain(code + ' is a waypoint of the ');
  expect(said.toasts[0]).toMatch(/ATS/);
  expect(said.toasts[0]).toContain('Nav waypoints from');
  // A code no chart has is still plainly unknown.
  const plain = await page.evaluate(async () => {
    const toasts = [];
    window.showToast = (m) => toasts.push(m);
    await buildRouteFromQuery('LLHZ QQXQZ LLIB');
    return toasts[0];
  });
  expect(plain).toBe('Unknown waypoint: QQXQZ');
});

test('a single search with no match offers the chart that has it, and switches to it', async ({ page }) => {
  const { code } = await boot(page);
  await page.evaluate(() => revealSearchOverlay());     // docked on desktop; summoned on a phone
  await page.fill('#wp-search', code);
  const row = page.locator('#wp-search-results .wp-search-other-chart');
  await expect(row).toBeVisible();
  await expect(row).toContainText(code + ' is a waypoint of the ');
  await expect(row).toContainText('tap to use');
  await row.click();
  await page.waitForFunction(() => window.navDataPrefix === 'ats');
  expect(await page.evaluate(() => localStorage.getItem('navaid.navDataPrefix'))).toBe('ats');
  // Searched again in the ATS set: now it is an ordinary hit.
  await expect(page.locator('#wp-search-results .wp-search-item').first()).toContainText(code);
  await expect(page.locator('#wp-search-results .wp-search-other-chart')).toHaveCount(0);
});

test('Hebrew says it in Hebrew', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof S !== 'undefined' && typeof S.errSearchOtherChart === 'function');
  const t = await page.evaluate(() => [S.errSearchOtherChart('ABCDE', 'נתיבי ATS', 'CVFR'),
    S.searchOtherChartRow('ABCDE', 'נתיבי ATS', 'נתיבי ATS')]);
  expect(t[0]).toContain('ציוני ניווט מתוך');
  expect(t[1]).toContain('הקישו');
});
