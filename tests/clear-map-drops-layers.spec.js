// @ts-check
// Clear map is "start again". Extra layers are switched on for a particular flight -- the
// plates for the fields it visits, the NOTAMs along it, the wind at the hour it was planned
// for -- so a cleared map still carrying them is the state this button exists to escape.
// Reported: the route went, the layers stayed.
//
// The rest of Clear map already worked and is pinned here too, because it is the kind of
// behaviour that gets lost in a refactor: no route, no notes, chart north-up, inspector shut.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof draw === 'function'
    && document.getElementById('clear'));
}

// Turn on a handful of Extra layers without going near the network: set the checkbox and
// fire its own handler, which is what a click does.
async function switchOn(page, ids) {
  // Through each toggle's own handler, but without the toolbar: several of these controls
  // stay hidden until their data arrives, and this is about Clear map, not about the menu.
  await page.evaluate((list) => {
    for (const i of list) {
      const cb = document.getElementById(i);
      if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
    }
  }, ids);
}
const checked = (page, ids) => page.evaluate((list) =>
  list.filter(i => (document.getElementById(i) || {}).checked), ids);

test('Clear map switches off the extra layers the flight was planned with', async ({ page }) => {
  await boot(page);
  const ids = ['msa-cb', 'airspace-cb', 'lsa-cb', 'circuit-cb'];
  await switchOn(page, ids);
  expect(await checked(page, ids)).toEqual(ids);

  page.once('dialog', d => d.accept());
  await page.evaluate(() => document.getElementById('clear').click());
  expect(await checked(page, ids)).toEqual([]);
});

test('every toggle in the Extra layers menu is cleared, not a hand-listed few', async ({ page }) => {
  await boot(page);
  // A hard-coded list would rot the next time a layer is added. Clear map walks the section,
  // so this asserts the section is what it walks.
  const all = await page.evaluate(() =>
    [...document.querySelectorAll('.tb-section[data-sec="weather"] input[type="checkbox"]')].map(c => c.id));
  expect(all.length).toBeGreaterThan(12);
  await page.evaluate((list) => {
    for (const i of list) {
      const cb = document.getElementById(i);
      // Set the flag without firing handlers: several layers fetch on enable, and this test
      // is about what Clear map switches off, not about loading them.
      if (cb) cb.checked = true;
    }
  }, all);
  page.once('dialog', d => d.accept());
  await page.evaluate(() => document.getElementById('clear').click());
  expect(await checked(page, all)).toEqual([]);
});

test('Clear map still empties the route, squares the chart and shuts the inspector', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.2, lng: 35.0, name: 'B' }];
    syncLegs();
    state.notes = [{ lat: 32.1, lng: 34.95, text: 'note' }];
    state.selected = { type: 'wp', index: 0 };
    showInspector();
    if (map.setBearing) map.setBearing(90);
  });
  expect(await page.evaluate(() => document.getElementById('inspector').classList.contains('hidden'))).toBe(false);

  page.once('dialog', d => d.accept());
  await page.evaluate(() => document.getElementById('clear').click());
  const after = await page.evaluate(() => ({
    wps: state.waypoints.length,
    legs: state.legs.length,
    notes: state.notes.length,
    bearing: map.getBearing ? Math.round(map.getBearing()) : 0,
    inspectorHidden: document.getElementById('inspector').classList.contains('hidden'),
  }));
  expect(after).toEqual({ wps: 0, legs: 0, notes: 0, bearing: 0, inspectorHidden: true });
});

test('a layer switched off by Clear map stays off across a reload', async ({ page }) => {
  await boot(page);
  await switchOn(page, ['msa-cb']);
  page.once('dialog', d => d.accept());
  await page.evaluate(() => document.getElementById('clear').click());
  // Each toggle is cleared through its own handler, so it persists exactly as a click would.
  // Otherwise the layer would come back on the next boot and the map would un-clear itself.
  await page.reload();
  await page.waitForFunction(() => document.getElementById('msa-cb'));
  expect(await page.evaluate(() => document.getElementById('msa-cb').checked)).toBe(false);
});
