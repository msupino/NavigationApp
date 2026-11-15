// @ts-check
// Reported: clearing the map (C) does not remove a shown recorded track.
//
// A track shown from Saved routes is an overlay on this map like the route, the notes and
// the extra layers -- all of which Clear map takes away. The flown line stayed, drawn over
// an otherwise empty chart, and the only way to be rid of it was to remember which library
// row had put it there and click Show again.
const { test, expect, answerAppDialogs } = require('./_setup');

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
  await answerAppDialogs(page, true);
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
  await answerAppDialogs(page, true);
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
  await answerAppDialogs(page, false);
  await page.evaluate(() => document.getElementById('clear').click());
  expect((await state(page)).shown).toEqual(['T1']);
  expect(await page.evaluate(() => state.waypoints.length)).toBe(2);

  await answerAppDialogs(page, true);
  await page.evaluate(() => document.getElementById('clear').click());
  expect((await state(page)).shown).toEqual([]);
  expect(await page.evaluate(() => state.waypoints.length)).toBe(0);
});

// Reported: "when showing a recorded flight, clear map is dimmed". Clear map takes the track
// away (above), so a shown track is something to clear: both Clears stay lit while it is shown
// -- also after a reload brings it back -- and dim again once it is hidden.
test('a shown track keeps Clear map lit', async ({ page }) => {
  await boot(page);
  const dims = () => page.evaluate(() => ['clear', 'edit-col-clear'].map(id =>
    document.getElementById(id).getAttribute('aria-disabled') === 'true'));
  // Nothing else on the map: no route, no notes, no extra layer.
  await page.evaluate(() => {
    for (const cb of document.querySelectorAll('.tb-section[data-sec="weather"] input[type="checkbox"]:checked')) cb.click();
    refreshEditColumn();
  });
  expect(await dims()).toEqual([true, true]);

  await showTrack(page);
  expect(await dims()).toEqual([false, false]);

  // A reload restores the shown track from Saved routes. boot()'s init script wipes both on
  // every load, so put them back for this one.
  await page.addInitScript(() => {
    const keep = sessionStorage.getItem('keepShown');
    if (!keep) return;
    const pts = [[32.0, 34.8], [32.1, 34.9], [32.2, 35.0]].map(p => ({ lat: p[0], lng: p[1], t: 1 }));
    localStorage.setItem('navaid.routes', JSON.stringify([{ id: 'T1', name: 'Sunday', track: pts }]));
    localStorage.setItem('navaid.tracks.shown', keep);
  });
  await page.evaluate(() => sessionStorage.setItem('keepShown', localStorage.getItem('navaid.tracks.shown')));
  await page.reload();
  await page.waitForFunction(() => typeof draw === 'function' && shownTracks.length === 1);
  await expect.poll(dims).toEqual([false, false]);

  await answerAppDialogs(page, true);
  await page.locator('#edit-col-clear').click();
  await expect.poll(async () => (await state(page)).shown).toEqual([]);
  expect(await dims()).toEqual([true, true]);
});
