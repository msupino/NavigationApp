// @ts-check
// Issue #487 — auto-seed a real note near route waypoints that sit on a
// comm-change reporting point.
//
// `seedCommChangeNotes()` (draw.js) is the single unit every placement/snap
// hook calls (drop, drag-end, touch-end, search route-build). It pushes a
// normal `state.notes` entry tagged `cc: <ICAO>` so it is movable / editable /
// deletable and never duplicates (the tag is the idempotency key, and it
// survives reload / export / import). Crucially it is NOT wired into draw() /
// load / import / undo, so a note the user deletes is not resurrected on the
// next repaint.
//
// Reuses the comm-change fixture pattern (page.route stub) so the tests don't
// depend on the shipped dataset's contents.
const { test, expect } = require('./_setup');

const TYONA = { lat: 32.00472, lng: 34.72722, name: 'TYONA' };
const NOTE_LAT_OFFSET = 0.012;   // keep in sync with COMM_CHANGE_NOTE_LAT_OFFSET

const FIXTURE = {
  version: 1,
  source: 'test fixture',
  points: [
    { name: 'TYONA', commChange: true, verified: false },
    { name: 'SORES', commChange: true, verified: false },
  ],
};

async function installCommChangeFixture(page, fixture = FIXTURE) {
  await page.route('**/comm-change.json*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(fixture),
  }));
}

async function boot(page, lang = 'en') {
  await page.addInitScript(() => {
    try {
      for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
      sessionStorage.clear();
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + s, '1');
    } catch (e) {}
  });
  await page.goto('?lang=' + lang);
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof window.seedCommChangeNotes === 'function');
  await page.evaluate(() => loadNavWaypoints());
  await page.waitForFunction(() => Array.isArray(window.navWP) && window.navWP.length > 0);
  await page.evaluate(() => loadCommChange());
  await page.waitForFunction(() => window.commChangeMap && window.commChangeMap.TYONA);
  await page.evaluate(() => { window.showCommChange = true; });
  await page.evaluate(t => map.setView([t.lat, t.lng], 11), TYONA);
  await page.evaluate(() => { state.waypoints = []; state.legs = []; state.notes = []; });
}

test.describe('comm-change auto-note (#487)', () => {
  test('seeds one tagged note near a comm-change waypoint', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const notes = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      return state.notes;
    }, TYONA);
    expect(notes).toHaveLength(1);
    expect(notes[0].cc).toBe('TYONA');
    expect(notes[0].text).toBe('Freq change');
    expect(notes[0].shape).toBe('rect');
    expect(notes[0].color).toBeTruthy();
    // Placed just north of the dot, same longitude.
    expect(notes[0].lat).toBeCloseTo(TYONA.lat + NOTE_LAT_OFFSET, 4);
    expect(notes[0].lng).toBeCloseTo(TYONA.lng, 4);
  });

  test('is idempotent — a second seed call adds no duplicate', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const count = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      seedCommChangeNotes();   // re-snap / re-draw simulation
      return state.notes.length;
    }, TYONA);
    expect(count).toBe(1);
  });

  test('a non-comm-change waypoint seeds nothing', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const count = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.1, lng: 34.9, name: 'NOPEX' }];
      syncLegs();
      seedCommChangeNotes();
      return state.notes.length;
    });
    expect(count).toBe(0);
  });

  test('the seeded note is a real, deletable note that draw() does not resurrect', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const after = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      const seeded = state.notes.length;
      // User deletes it like any manual note.
      state.notes.splice(0, 1);
      // Repaint — must NOT re-seed (seeding is not wired into draw()).
      draw();
      return { seeded, afterDelete: state.notes.length };
    }, TYONA);
    expect(after.seeded).toBe(1);
    expect(after.afterDelete).toBe(0);
  });

  test('search route-build seeds notes for its comm-change waypoints', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    // TYONA and SORES are both real nav waypoints AND comm-change points in
    // the fixture, so a two-token route-build must seed a note for each.
    const tagged = await page.evaluate(async () => {
      await buildRouteFromQuery('TYONA SORES');
      return state.notes.map(n => n.cc).filter(Boolean).sort();
    });
    expect(tagged).toEqual(['SORES', 'TYONA']);
  });

  test('Hebrew locale seeds the translated note label', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page, 'he');
    const text = await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      syncLegs();
      seedCommChangeNotes();
      return state.notes[0].text;
    }, TYONA);
    expect(text).toBe('שינוי תדר');
  });
});
