// @ts-check
// Coverage for the drop/drag auto-snap (applyNavSnap + nearestAirfield +
// nearestNavWaypoint). Dropping or dragging a waypoint near a known airfield
// or nav-waypoint snaps its coords and adopts the canonical name; airfields
// win ties; user-typed names survive; auto-snap names clear when the marker
// is moved away or both overlays are off.
const { test, expect } = require('./_setup');
const { LLHZ } = require('./_airfieldArp');

async function boot(page) {
  await page.goto('?lang=en');
  await page.waitForFunction(() =>
    typeof applyNavSnap === 'function' &&
    typeof state !== 'undefined' &&
    Array.isArray(window.airfields) && window.airfields.length > 0 &&
    Array.isArray(window.navWP) && window.navWP.length > 0);
}

test.describe('Auto-snap (applyNavSnap)', () => {
  test('drop on an airfield adopts its ICAO and snaps coords', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(hz => {
      window.showAirfields = true; window.showNavWP = true;
      map.setView([hz.lat, hz.lng], 12);
      return applyNavSnap({ lat: hz.lat, lng: hz.lng }, '');
    }, LLHZ);
    expect(r.name).toBe('LLHZ');
    expect(r.lat).toBeCloseTo(LLHZ.lat, 5);
    expect(r.lng).toBeCloseTo(LLHZ.lng, 5);
  });

  test('airfield wins over nav-waypoint when both overlays are on', async ({ page }) => {
    await boot(page);
    // Drop exactly on the airfield ARP with both overlays on: the result must
    // be the airfield ICAO, never a nav-WP name.
    const name = await page.evaluate(hz => {
      window.showAirfields = true; window.showNavWP = true;
      map.setView([hz.lat, hz.lng], 12);
      return applyNavSnap({ lat: hz.lat, lng: hz.lng }, '').name;
    }, LLHZ);
    expect(name).toBe('LLHZ');
  });

  test('drop on a nav-waypoint adopts its name (airfields off)', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => {
      window.showAirfields = false; window.showNavWP = true;
      const nw = navWP[0];
      map.setView([nw.lat, nw.lng], 12);
      const r = applyNavSnap({ lat: nw.lat, lng: nw.lng }, '');
      return { r, expected: nw[S.navWpSearchField] || nw.name,
               lat: nw.lat, lng: nw.lng };
    });
    expect(out.r.name).toBe(out.expected);
    expect(out.r.lat).toBeCloseTo(out.lat, 5);
    expect(out.r.lng).toBeCloseTo(out.lng, 5);
  });

  test('user-typed name survives a snap (coords move, name kept)', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(hz => {
      window.showAirfields = true; window.showNavWP = true;
      map.setView([hz.lat, hz.lng], 12);
      return applyNavSnap({ lat: hz.lat, lng: hz.lng }, 'HOME');
    }, LLHZ);
    expect(r.name).toBe('HOME');
    expect(r.lat).toBeCloseTo(LLHZ.lat, 5);   // coords still snap to the ARP
  });

  test('moving an auto-snap name away from any feature clears the name', async ({ page }) => {
    await boot(page);
    // Drop a previously-snapped ICAO far from any feature: no snap, name clears.
    const r = await page.evaluate(() => {
      window.showAirfields = true; window.showNavWP = true;
      map.setView([32, 35], 12);
      return applyNavSnap({ lat: 30, lng: 30 }, 'LLHZ');
    });
    expect(r.name).toBe('');
    expect(r.lat).toBe(30);
    expect(r.lng).toBe(30);
  });

  test('both overlays off: no coord snap, but an auto-snap name still clears', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(hz => {
      window.showAirfields = false; window.showNavWP = false;
      map.setView([hz.lat, hz.lng], 12);
      return applyNavSnap({ lat: hz.lat, lng: hz.lng }, 'LLHZ');
    }, LLHZ);
    expect(r.name).toBe('');                   // ICAO is an auto-snap name -> cleared
    expect(r.lat).toBeCloseTo(LLHZ.lat, 5);    // coords untouched (no snap)
  });

  test('both overlays off: a user-typed name is preserved', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(hz => {
      window.showAirfields = false; window.showNavWP = false;
      map.setView([hz.lat, hz.lng], 12);
      return applyNavSnap({ lat: hz.lat, lng: hz.lng }, 'HOME');
    }, LLHZ);
    expect(r.name).toBe('HOME');
  });
});
