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

  // #106/#240: force-snap lifts the snap radius to infinity. The old code
  // short-circuited on airfields, so at infinite radius the 16-airfield set
  // always won and the 173 nav-waypoints became unreachable. A click on a
  // nav-WP must snap to that nav-WP, not a distant airfield.
  test('force-snap: click on a nav-waypoint snaps to it, not a distant airfield', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => {
      window.showAirfields = true; window.showNavWP = true;
      window.forceSnap = true;
      const dist = (a, b) => Math.hypot(a.lat - b.lat, a.lng - b.lng);
      // Pick the nav-WP farthest from any airfield: the pre-fix bug would snap
      // it to the nearest airfield, which is unmistakably the wrong feature.
      let target = null, best = -1;
      for (const w of navWP) {
        let dmin = Infinity;
        for (const af of airfields) dmin = Math.min(dmin, dist(w, af));
        if (dmin > best) { best = dmin; target = w; }
      }
      map.setView([target.lat, target.lng], 10);
      const r = applyNavSnap({ lat: target.lat, lng: target.lng }, '');
      return { r, expected: target[S.navWpSearchField] || target.name,
               lat: target.lat, lng: target.lng };
    });
    expect(out.r.name).toBe(out.expected);
    expect(out.r.lat).toBeCloseTo(out.lat, 5);
    expect(out.r.lng).toBeCloseTo(out.lng, 5);
  });

  test('force-snap: click on an airfield still snaps to the airfield', async ({ page }) => {
    await boot(page);
    const name = await page.evaluate(hz => {
      window.showAirfields = true; window.showNavWP = true;
      window.forceSnap = true;
      map.setView([hz.lat, hz.lng], 10);
      return applyNavSnap({ lat: hz.lat, lng: hz.lng }, '').name;
    }, LLHZ);
    expect(name).toBe('LLHZ');
  });

  test('excludeLl suppresses snap to origin so WP can escape its own position', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(hz => {
      window.showAirfields = true; window.showNavWP = true;
      window.forceSnap = true;
      map.setView([hz.lat, hz.lng], 10);
      // Mouse is still at LLHZ but origin is excluded — must NOT snap to LLHZ.
      const r = applyNavSnap({ lat: hz.lat, lng: hz.lng }, 'LLHZ',
                              { lat: hz.lat, lng: hz.lng });
      return { name: r.name, lat: r.lat, lng: r.lng };
    }, LLHZ);
    expect(out.name).not.toBe('LLHZ');
  });

  test('drag waypoint returning to snap-origin is deleted', async ({ page }) => {
    await boot(page);
    const wpCount = await page.evaluate(hz => {
      window.showAirfields = true; window.showNavWP = true;
      window.forceSnap = true;
      map.setView([hz.lat, hz.lng], 12);
      state.waypoints = [{ lat: hz.lat, lng: hz.lng, name: 'LLHZ' }];
      syncLegs(); draw();
      const orig = { lat: hz.lat, lng: hz.lng };
      const wp = state.waypoints[0];
      const SNAP_DEG = 0.0002;
      if (Math.abs(wp.lat - orig.lat) < SNAP_DEG &&
          Math.abs(wp.lng - orig.lng) < SNAP_DEG) {
        state.waypoints.splice(0, 1);
        state.selected = null;
        syncLegs();
      }
      return state.waypoints.length;
    }, LLHZ);
    expect(wpCount).toBe(0);
  });
});
