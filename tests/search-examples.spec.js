// @ts-check
// The search box reads like a name search, but it also builds a route from codes and reads
// coordinates in three notations -- and nothing said so but a tip that retires after the first
// search (reported). A "?" beside it lists what it understands, as real examples to tap.
const { test, expect } = require('./_setup');

async function boot(page, lang) {
  await page.goto('?lang=' + (lang || 'en') + '&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof runSearch === 'function');
  await page.evaluate(() => loadNavWaypoints());
  await page.waitForFunction(() => Array.isArray(window.navWP) && window.navWP.length > 0);
  await page.evaluate(() => loadAirfields && loadAirfields());
  await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
  // Opened the way the app opens it: on a desktop the search is docked and the toolbar
  // button that would open it is not on screen to click.
  await page.evaluate(() => revealSearchOverlay());
  await expect(page.locator('#wp-search')).toBeVisible();
  // VORs are pulled in when the search opens.
  await page.waitForFunction(() => Array.isArray(window.vors) && window.vors.length > 0);
}

test('"?" opens tappable examples of everything the search reads', async ({ page }) => {
  await boot(page);
  const help = page.locator('#search-help');
  await expect(help).toBeVisible();
  await expect(help).toHaveAttribute('aria-expanded', 'false');
  await help.click();
  await expect(help).toHaveAttribute('aria-expanded', 'true');
  const rows = page.locator('#search-examples .search-ex');
  await expect(rows).toHaveCount(8);
  const text = await page.locator('#search-examples').innerText();
  for (const s of ['Reporting point', 'Airfield', 'VOR', 'route', 'decimal', 'degrees minutes seconds', 'flight-plan', 'NOTAM']) {
    expect(text).toContain(s);
  }
  // The route tip repeats the route example: out of the way while the list is open.
  await expect(page.locator('#wp-search-hint')).toBeHidden();
  await help.click();
  await expect(page.locator('#search-examples')).toBeHidden();
});

test('every example is real: tapping it puts it in the box and finds something', async ({ page }) => {
  await boot(page);
  for (let k = 0; k < 8; k++) {
    await page.locator('#search-help').click();
    const row = page.locator('#search-examples .search-ex').nth(k);
    const example = await row.locator('code').innerText();
    await row.click();
    await expect(page.locator('#search-examples')).toBeHidden();
    await expect(page.locator('#wp-search')).toHaveValue(example);
    // A coordinate goes straight there (one answer); anything else lists its hits to pick from.
    const isCoord = await page.evaluate((q) => !!parseSearchLatLng(q), example);
    if (isCoord) {
      await expect.poll(() => page.evaluate(() => state.selected && state.selected.type), example).toBe('coord');
    } else {
      await expect(page.locator('#wp-search-results .wp-search-item').first(), example).toBeVisible();
    }
    await page.evaluate(() => { wpSearch.value = ''; closeSearch(); state.selected = null; });
  }
});

test('typing puts the examples away', async ({ page }) => {
  await boot(page);
  await page.locator('#search-help').click();
  await expect(page.locator('#search-examples')).toBeVisible();
  await page.locator('#wp-search').type('S');
  await expect(page.locator('#search-examples')).toBeHidden();
});

test('Hebrew: the button and the examples are labelled in Hebrew', async ({ page }) => {
  await boot(page, 'he');
  await expect(page.locator('#search-help')).toHaveAttribute('title', 'מה אפשר לחפש?');
  await page.locator('#search-help').click();
  await expect(page.locator('#search-examples')).toContainText('נקודת דיווח');
  await expect(page.locator('#search-examples')).toContainText('הרצליה');
});

// Reported: "32.18 34.83" and "N32 10 48 E034 50 04" did not work. Both have spaces, and Enter read
// any two tokens as a route to build -- waypoints named "32.18" and "34.83". A coordinate is read
// whole first, the way the dropdown already read it.
for (const q of ['32.18 34.83', 'N32 10 48 E034 50 04']) {
  test('Enter on "' + q + '" goes to the coordinate, it does not build a route', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { state.waypoints = []; syncLegs(); });
    await page.locator('#wp-search').fill(q);
    await page.locator('#wp-search').press('Enter');
    await expect.poll(() => page.evaluate(() => state.selected && state.selected.type)).toBe('coord');
    const sel = await page.evaluate(() => ({ lat: state.selected.lat, lng: state.selected.lng, wps: state.waypoints.length }));
    expect(sel.wps).toBe(0);
    expect(sel.lat).toBeCloseTo(32.18, 2);
    expect(sel.lng).toBeCloseTo(34.83, 1);
  });
}
