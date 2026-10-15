// @ts-check
// The planning form (met table, deviation card, speeds...) travels with its saved route.
// Reported: a route saved to the library and synced to Google Drive arrived on the other
// device without its met table or compass card -- navaid.navlog is device-local, and the
// library entry carried only the route. Now the entry carries the typed form beside `data`,
// opening it puts the form back, and a form edit is an unsaved change, so Save writes it.
const { test, expect } = require('./_setup');

const MET = [{ alt: 2000, dir: 315, kt: 17, tempC: 10 }, { alt: 6000, dir: 320, kt: 25, tempC: 2 }];
const CARD = [{ mh: 0, ch: 358 }, { mh: 30, ch: 27 }, { mh: 60, ch: 59 }];

async function boot(page) {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&nogist');
  // The airfield dataset is the last thing boot waits on; by then every script has run.
  await page.waitForFunction(() => !!(window.NavAid && NavAid.navLog && NavAid.navLog.forRoute)
    && typeof routeFileDirty === 'function'
    && Array.isArray(window.airfields) && window.airfields.length > 0);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'A' }, { lat: 32.98, lng: 35.57, name: 'B' }];
    syncLegs();
  });
}

test('a saved route carries its typed planning form, and only what was typed', async ({ page }) => {
  await boot(page);
  const entry = await page.evaluate(({ met, card }) => {
    localStorage.setItem('navaid.navlog', JSON.stringify({ met, deviation: card, variationDeg: 4, cas: { climb: 65 } }));
    return routeLibrarySaveCurrent('Exercise');
  }, { met: MET, card: CARD });
  expect(entry.navlog.met).toEqual(MET);
  expect(entry.navlog.deviation).toEqual(CARD);
  expect(entry.navlog.variationDeg).toBe(4);
  // A partly typed group keeps only its typed member: the rest is derived on the device that opens it.
  expect(entry.navlog.cas).toEqual({ climb: 65 });
  expect(entry.navlog.fuel).toBeUndefined();
  // Beside the route, not in it: `data` stays the route's own shape.
  expect(entry.data.navlog).toBeUndefined();
});

test('opening the synced entry on another device brings the form back', async ({ page }) => {
  await boot(page);
  const lib = await page.evaluate(({ met, card }) => {
    localStorage.setItem('navaid.navlog', JSON.stringify({ met, deviation: card, variationDeg: 4 }));
    routeLibrarySaveCurrent('Exercise');
    return localStorage.getItem('navaid.routes');
  }, { met: MET, card: CARD });

  // "Another device": nothing typed, no route on the map, only the library Drive delivered
  // (through the same merge the sync uses).
  const got = await page.evaluate(async (raw) => {
    localStorage.removeItem('navaid.navlog');
    state.waypoints = []; syncLegs();
    const merged = mergeRouteLibraries([], JSON.parse(raw));
    localStorage.setItem('navaid.routes', JSON.stringify(merged));
    const entry = loadRouteLibrary()[0];
    const ok = await routeLibraryApply(entry);
    const c = NavAid.navLog.config();
    return { ok, met: c.met, deviation: c.deviation, variationDeg: c.variationDeg, wps: state.waypoints.length };
  }, lib);
  expect(got.ok).toBe(true);
  expect(got.wps).toBe(2);
  expect(got.met).toEqual(MET);
  expect(got.deviation).toEqual(CARD);
  expect(got.variationDeg).toBe(4);
});

test('a form edit is an unsaved change, and Save writes it', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(({ met }) => {
    localStorage.setItem('navaid.navlog', JSON.stringify({ met }));
    const e = routeLibrarySaveCurrent('Exercise');
    const clean = routeFileDirty(e);
    // A new deviation card typed after saving: the route is unchanged, the form is not.
    localStorage.setItem('navaid.navlog', JSON.stringify({ met, deviation: [{ mh: 0, ch: 2 }] }));
    const dirty = routeFileDirty(loadRouteLibrary()[0]);
    const updated = routeLibraryUpdate(e.id);
    return { clean, dirty, card: updated.navlog.deviation, after: routeFileDirty(updated) };
  }, { met: MET });
  expect(r.clean).toBe(false);
  expect(r.dirty).toBe(true);
  expect(r.card).toEqual([{ mh: 0, ch: 2 }]);
  expect(r.after).toBe(false);
});

test('a route saved without a form leaves this device\'s form alone', async ({ page }) => {
  await boot(page);
  const met = await page.evaluate(async ({ met }) => {
    const e = routeLibrarySaveCurrent('Plain');            // nothing typed: no navlog on it
    localStorage.setItem('navaid.navlog', JSON.stringify({ met }));
    state.waypoints = []; syncLegs();
    await routeLibraryApply(e);
    return NavAid.navLog.config().met;
  }, { met: MET });
  expect(met).toEqual(MET);
});
