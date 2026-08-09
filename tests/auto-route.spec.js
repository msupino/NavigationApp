// @ts-check
// Auto-route on the MAP: adding a reporting point extends the route along the published
// corridor from the previous point, availability honoured -- instead of a straight line
// the pilot has to subdivide by hand. CVFR only; filing-time expansion is independent.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try { for (const s of ['build', 'view', 'display']) localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof autoRouteChain === 'function' && typeof airfieldByIcao === 'function');
  // Ships OFF (it changes what the route contains): every test here opts in first, and the
  // default-off behaviour has its own test below.
  await page.evaluate(async () => {
    window.autoRouteCorridors = true;
    await loadAirfields(); await loadNavWaypoints();
  });
}

test('LLHA to LLHZ follows the open corridor, not a direct line', async ({ page }) => {
  await boot(page);
  const names = await page.evaluate(async () => {
    const ha = airfieldByIcao('LLHA'), hz = airfieldByIcao('LLHZ');
    const mid = await autoRouteChain(
      { lat: ha.lat, lng: ha.lng, name: 'LLHA' },
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' });
    return mid && mid.map(w => w.name);
  });
  // The northern arrival, coastal corridor -- and no airfield mid-route, no closed inland
  // HASID leg.
  expect(names).toEqual(['GALIM', 'DAROM', 'HOTRM', 'BOREN', 'FRDIS',
    'HADRA', 'ZYAAR', 'SHARO', 'DEROR', 'BAZRA']);
});

test('LLHZ to LLHA is the same corridor flown the other way', async ({ page }) => {
  await boot(page);
  const names = await page.evaluate(async () => {
    const ha = airfieldByIcao('LLHA'), hz = airfieldByIcao('LLHZ');
    const mid = await autoRouteChain(
      { lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      { lat: ha.lat, lng: ha.lng, name: 'LLHA' });
    return mid && mid.map(w => w.name);
  });
  expect(names).toEqual(['BAZRA', 'DEROR', 'SHARO', 'ZYAAR', 'HADRA',
    'FRDIS', 'BOREN', 'HOTRM', 'DAROM', 'GALIM']);
});

test('a map tap in add mode splices the corridor as real waypoints', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const hz = airfieldByIcao('LLHZ');
    state.waypoints = [{ lat: hz.lat, lng: hz.lng, name: 'LLHZ' }];
    syncLegs();
    setMode('add');
    const ridng = navWP.find(w => w.name === 'RIDNG');
    map.setView([ridng.lat, ridng.lng], 12);
    const pt = map.latLngToContainerPoint([ridng.lat, ridng.lng]);
    return { x: pt.x, y: pt.y };
  });
  await page.mouse.click(r.x, r.y);
  // The splice is async (the graph loads lazily): wait for the corridor to slot in.
  await page.waitForFunction(() => state.waypoints.length > 2, { timeout: 8000 });
  const names = await page.evaluate(() => state.waypoints.map(w => w.name));
  expect(names).toEqual(['LLHZ', 'SFAIM', 'APOLN', 'ARENA', 'HTZUK', 'RIDNG']);
  // Inserted points are ordinary waypoints, tagged for provenance only.
  const tags = await page.evaluate(() => state.waypoints.map(w => !!w._autoRouted));
  expect(tags).toEqual([false, true, true, true, true, false]);
  // Deleting one deletes that point only -- no hidden re-route.
  await page.evaluate(() => { state.waypoints.splice(2, 1); syncLegs(); draw(); });
  expect(await page.evaluate(() => state.waypoints.length)).toBe(5);
});

test('every add path splices the corridor, not just the map tap', async ({ page }) => {
  // A pilot who adds a point with the inspector's "Add to route" button expects the same
  // route a tap would have drawn -- the corridor splice used to hang off the map-tap path
  // alone, so adding by button (or extend-through) drew a straight line.
  await boot(page);
  const names = await page.evaluate(async () => {
    const hz = airfieldByIcao('LLHZ');
    state.waypoints = [{ lat: hz.lat, lng: hz.lng, name: 'LLHZ' }];
    syncLegs();
    // Select RIDNG's nav-waypoint and press its "Add to route" button, as a pilot would.
    await loadNavWaypoints();
    const i = navWP.findIndex(w => w.name === 'RIDNG');
    state.selected = { type: 'navwp', index: i };
    showInspector();
    document.getElementById('insp-add-to-route').click();
    await new Promise(r => setTimeout(r, 1200));
    return state.waypoints.map(w => w.name);
  });
  expect(names).toEqual(['LLHZ', 'SFAIM', 'APOLN', 'ARENA', 'HTZUK', 'RIDNG']);
});

test('an unnamed tap near a reporting point still routes', async ({ page }) => {
  // A tap only gets a NAME within the 18 px snap radius; auto-route resolves by position
  // (half a mile) too, or a slightly-off tap silently produced no corridor.
  await boot(page);
  const names = await page.evaluate(async () => {
    const hz = airfieldByIcao('LLHZ');
    await loadNavWaypoints();
    const ridng = navWP.find(w => w.name === 'RIDNG');
    const mid = await autoRouteChain(
      { lat: hz.lat, lng: hz.lng, name: '' },                       // unnamed
      { lat: ridng.lat + 0.002, lng: ridng.lng, name: '' });        // unnamed, ~0.12 nm off
    return mid && mid.map(w => w.name);
  });
  expect(names).toEqual(['SFAIM', 'APOLN', 'ARENA', 'HTZUK']);
});

test('it ships off: the shipped default draws a direct line', async ({ page }) => {
  await page.addInitScript(() => {
    try { for (const s of ['build', 'view', 'display']) localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof autoRouteChain === 'function');
  const off = await page.evaluate(() => ({
    flag: window.autoRouteCorridors,
    checkbox: document.getElementById('autoroute-cb').checked,
  }));
  expect(off.flag).toBe(false);
  expect(off.checkbox).toBe(false);
});

test('the toggle turns it off again after opting in', async ({ page }) => {
  await boot(page);
  const names = await page.evaluate(async () => {
    window.autoRouteCorridors = false;
    const hz = airfieldByIcao('LLHZ');
    state.waypoints = [{ lat: hz.lat, lng: hz.lng, name: 'LLHZ' }];
    syncLegs();
    setMode('add');
    const ridng = navWP.find(w => w.name === 'RIDNG');
    const mid = await autoRouteChain(state.waypoints[0], { lat: ridng.lat, lng: ridng.lng, name: 'RIDNG' });
    return mid;
  });
  expect(names).toBeNull();
});

test('off the CVFR layer it stays out of the way', async ({ page }) => {
  await boot(page);
  const mid = await page.evaluate(async () => {
    for (const k in layers) if (map.hasLayer(layers[k])) map.removeLayer(layers[k]);
    map.addLayer(layers['Low Alt']);
    reloadLayerDatasets();
    const hz = airfieldByIcao('LLHZ');
    return autoRouteChain({ lat: hz.lat, lng: hz.lng, name: 'LLHZ' },
      { lat: 32.21056, lng: 34.80722, name: 'SFAIM' });
  });
  expect(mid).toBeNull();
});
