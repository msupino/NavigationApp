// @ts-check
// Reported: clearing the map (C) does not remove a shown recorded track.
//
// A track shown from Saved routes is an overlay on this map like the route, the notes and
// the extra layers -- all of which Clear map takes away. The flown line stayed, drawn over
// an otherwise empty chart, and the only way to be rid of it was to remember which library
// row had put it there and click Show again.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('navaid.routes');
      localStorage.removeItem('navaid.tracks.shown');
    } catch (e) { /* storage unavailable */ }
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showTrackOverlay === 'function'
    && typeof draw === 'function' && document.getElementById('clear'));
}

const showTrack = (page) => page.evaluate(() => {
  const pts = [[32.0, 34.8], [32.1, 34.9], [32.2, 35.0]]
    .map(p => ({ lat: p[0], lng: p[1], t: Date.now() }));
  showTrackOverlay({ id: 'T1', name: 'Sunday', track: pts });
  return { shown: shownTracks.map(t => t.id), persisted: localStorage.getItem('navaid.tracks.shown') };
});

const state = (page) => page.evaluate(() => ({
  shown: shownTracks.map(t => t.id),
  persisted: JSON.parse(localStorage.getItem('navaid.tracks.shown') || '[]'),
  drawn: (draw(), window.__tracksDrawn || 0),
}));

test('Clear map takes the shown track with it', async ({ page }) => {
  await boot(page);
  expect((await showTrack(page)).shown).toEqual(['T1']);
  page.on('dialog', d => d.accept());
  await page.evaluate(() => document.getElementById('clear').click());
  const after = await state(page);
  expect(after.shown).toEqual([]);
  expect(after.drawn, 'the line is still being drawn').toBe(0);
  // ...and it does not come back on the next reload: the overlay was hidden through its own
  // handler, which rewrites what is persisted.
  expect(after.persisted).toEqual([]);
  await page.reload();
  await page.waitForFunction(() => typeof draw === 'function');
  expect((await state(page)).shown).toEqual([]);
});

test('the C shortcut clears it too -- it is the same button', async ({ page }) => {
  await boot(page);
  await showTrack(page);
  page.on('dialog', d => d.accept());
  await page.locator('#map').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('c');
  await expect.poll(async () => (await state(page)).shown).toEqual([]);
});

test('a route and a track go together, and the confirm still guards the route', async ({ page }) => {
  await boot(page);
  await showTrack(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.3, lng: 35.1, name: 'B' }];
    syncLegs();
    draw();
  });
  // Declining the confirm leaves everything alone -- the track included. Clear map is one
  // action, and half of it happening after "no" would be worse than none of it.
  page.once('dialog', d => d.dismiss());
  await page.evaluate(() => document.getElementById('clear').click());
  expect((await state(page)).shown).toEqual(['T1']);
  expect(await page.evaluate(() => state.waypoints.length)).toBe(2);

  page.once('dialog', d => d.accept());
  await page.evaluate(() => document.getElementById('clear').click());
  expect((await state(page)).shown).toEqual([]);
  expect(await page.evaluate(() => state.waypoints.length)).toBe(0);
});
