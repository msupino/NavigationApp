// @ts-check
// LSA bubbles are clickable and searchable. A bubble's inspector answers the two questions
// that change a plan: what altitude band, and from what weekday hour it is open at all.
const { test, expect } = require('./_setup');

async function bootLsa(page) {
  await page.addInitScript(() => {
    try { for (const s of ['build', 'view', 'display']) localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' && typeof layers !== 'undefined');
  await page.evaluate(async () => {
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['Low Alt']);
    if (typeof reloadLayerDatasets === 'function') reloadLayerDatasets();
    window.showLsaBubbles = true;
    await loadAreas();
  });
  await page.waitForFunction(() => Array.isArray(areas) && areas.length > 0);
}

test('the dataset carries codes, bands and gates', async ({ page }) => {
  await bootLsa(page);
  const d = await page.evaluate(() => ({
    count: areas.length,
    coded: areas.filter(a => a.icao).length,
    banded: areas.filter(a => Number.isFinite(a.lowFt) && Number.isFinite(a.highFt)).length,
    gated: areas.filter(a => a.openFromHour != null).length,
  }));
  expect(d.count).toBe(37);
  expect(d.coded).toBe(37);
  expect(d.banded).toBe(37);
  expect(d.gated).toBeGreaterThan(25);
});

test('clicking inside a bubble opens its inspector with band and gate', async ({ page }) => {
  await bootLsa(page);
  await page.evaluate(() => {
    const a = areas.find(x => x.icao === 'BOORN');
    const c = areaCentroid(a.coords);
    map.setView([c.lat, c.lng], 11);
  });
  await page.waitForTimeout(400);
  const pt = await page.evaluate(() => {
    const a = areas.find(x => x.icao === 'BOORN');
    const c = areaCentroid(a.coords);
    const s = map.latLngToContainerPoint([c.lat, c.lng]);
    return { x: s.x, y: s.y };
  });
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator('#inspector')).not.toHaveClass(/hidden/);
  await expect(page.locator('#insp-title')).toHaveValue(/BOORN/);
  const body = page.locator('#insp-body');
  await expect(body).toContainText('0-2100 ft');
  await expect(body).toContainText('12:00');       // the weekday gate
});

test('a bubble is searchable by code, and the hit opens the inspector', async ({ page }) => {
  await bootLsa(page);
  await page.fill('#wp-search', 'BYMLH');
  await page.waitForSelector('#wp-search-results:not(.hidden)');
  const first = page.locator('#wp-search-results > *').first();
  await expect(first).toContainText('BYMLH');
  await expect(first).toContainText('ft');         // the band rides in the result line
  await first.click();
  await expect(page.locator('#insp-title')).toHaveValue(/BYMLH/);
  await expect(page.locator('#insp-body')).toContainText('0-3000 ft');
  // ...and the map flew there with the search ring.
  await expect(page.locator('.search-flash')).toHaveCount(1);
});

test('an ungated bubble says open all day, and a route waypoint still wins the click', async ({ page }) => {
  await bootLsa(page);
  const r = await page.evaluate(() => {
    const a = areas.find(x => x.openFromHour == null);
    return a && a.icao;
  });
  await page.fill('#wp-search', r);
  await page.waitForSelector('#wp-search-results:not(.hidden)');
  await page.locator('#wp-search-results > *').first().click();
  await expect(page.locator('#insp-body')).toContainText('Open all day');
  // Priority: drop a waypoint inside a bubble; clicking it must select the waypoint,
  // not the bubble underneath it.
  await page.evaluate(() => {
    const a = areas.find(x => x.icao === 'BOORN');
    const c = areaCentroid(a.coords);
    map.setView([c.lat, c.lng], 11);
    state.waypoints = [{ lat: c.lat, lng: c.lng, name: 'WP1' }];
    syncLegs(); draw();
  });
  await page.waitForTimeout(300);
  const pt = await page.evaluate(() => {
    const s = map.latLngToContainerPoint([state.waypoints[0].lat, state.waypoints[0].lng]);
    return { x: s.x, y: s.y };
  });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(300);
  const sel = await page.evaluate(() => state.selected && state.selected.type);
  expect(sel).toBe('wp');
});
