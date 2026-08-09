// @ts-check
// The per-leg drift override is symmetric: hideDrift beats a global ON, and showDrift
// beats a global OFF. The global used to be a hard ceiling, so the inspector's "Show
// drift lines" button was a no-op whenever the toolbar toggle was off.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try { for (const s of ['build', 'view', 'display']) localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof legDriftVisible === 'function');
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.18, lng: 34.83, name: 'A' },
      { lat: 32.30, lng: 34.90, name: 'B' },
    ];
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 90;
    draw();
  });
}

test('the effective-visibility truth table', async ({ page }) => {
  await boot(page);
  const table = await page.evaluate(() => [
    legDriftVisible({}, true),                       // default under global on
    legDriftVisible({}, false),                      // default under global off
    legDriftVisible({ hideDrift: 1 }, true),         // per-leg hide beats global on
    legDriftVisible({ showDrift: 1 }, false),        // per-leg show beats global off
    legDriftVisible({ hideDrift: 1, showDrift: 1 }, false),  // hide wins a conflict
  ]);
  expect(table).toEqual([true, false, false, true, false]);
});

test('with the global off, the inspector button turns ONE leg back on', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { window.showDrift = false; draw(); });
  await page.evaluate(() => { state.selected = { type: 'leg', index: 0 }; showInspector(); });
  // Effective state is hidden, so the button offers Show...
  const btns = page.locator('#insp-body .insp-btn');
  const driftBtn = btns.filter({ hasText: /drift/i }).first();
  await expect(driftBtn).toContainText(/Show drift lines/);
  await driftBtn.click();
  // ...and clicking it makes THIS leg's cone effective without touching the global.
  const after = await page.evaluate(() => ({
    global: window.showDrift,
    flag: state.legs[0].showDrift,
    effective: legDriftVisible(state.legs[0], window.showDrift),
  }));
  expect(after.global).toBe(false);
  expect(after.flag).toBe(1);
  expect(after.effective).toBe(true);
  // The button relabels to what it now does.
  await expect(driftBtn).toContainText(/Hide drift lines/);
});

test('the override round-trips through save and import', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { window.showDrift = false; state.legs[0].showDrift = 1; });
  const round = await page.evaluate(() => serializeRoute().legs[0].showDrift);
  expect(round).toBe(1);
  // ...and a route loaded with the flag keeps it (the import validator accepts it).
  const back = await page.evaluate(() => {
    const data = serializeRoute();
    state.waypoints = []; state.legs = []; syncLegs();
    applyRouteData(data);
    return state.legs[0] && state.legs[0].showDrift;
  });
  expect(back).toBe(1);
});
