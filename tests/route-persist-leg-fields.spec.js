// @ts-check
// Two pieces of pilot-authored per-leg state that every persistence path was losing:
// the leg's own reference VOR (which decides its Radial/DME) and the dragged
// cumulative-time kite positions. Both were editable in the UI and both silently
// reverted — vorRef on reload AND on save/load, the kites on reload only — so the plan
// showed different navigational values than when it was saved, with nothing said.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + s, '1');
    } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof loadVors === 'function' && typeof serializeRoute === 'function' &&
    typeof persist === 'function');
  await page.evaluate(() => loadVors());
}

// Two legs, so an override on one can be shown NOT to leak to the other.
async function route(page) {
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.1, lng: 34.85, name: 'A' },
      { lat: 32.46472, lng: 34.91222, name: 'HADRA' },
      { lat: 32.6, lng: 35.0, name: 'C' },
    ];
    syncLegs();
    for (const l of state.legs) l.flightSpeed = 90;
    draw();
  });
}

test.describe('per-leg VOR override survives every persistence path', () => {
  test('a reload keeps the leg VOR, and only on the leg it was set on', async ({ page }) => {
    await boot(page);
    await route(page);
    await page.evaluate(() => {
      state.legs[0].vorRef = 'BGN';
      persist();
      // writeRoute is debounced behind persist(); force the blob out now.
      writeRoute();
    });
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('navaid.route')).legs.map(l => l.vorRef || null));
    expect(stored).toEqual(['BGN', null]);       // the snapshot carried it all along
    await page.reload();
    await page.waitForFunction(() => state.legs.length === 2);
    // ...it was restoreRoute() that dropped it, so the Radial/DME column quietly
    // recomputed against the GLOBAL reference VOR after a refresh.
    const after = await page.evaluate(() => state.legs.map(l => l.vorRef || null));
    expect(after).toEqual(['BGN', null]);
  });

  test('a JSON save/load round-trip keeps the leg VOR', async ({ page }) => {
    await boot(page);
    await route(page);
    const doc = await page.evaluate(() => {
      state.legs[1].vorRef = 'NAT';
      return serializeRoute();
    });
    // serializeRoute() is the single source of the on-disk shape — it omitted vorRef
    // entirely, so the field never even reached the file or the route library.
    expect(doc.legs.map(l => l.vorRef || null)).toEqual([null, 'NAT']);
    const back = await page.evaluate(d => {
      state.waypoints = []; state.legs = []; syncLegs();
      applyRouteData(d);
      return state.legs.map(l => l.vorRef || null);
    }, doc);
    expect(back).toEqual([null, 'NAT']);
  });

  test('the route library keeps the leg VOR', async ({ page }) => {
    await boot(page);
    await route(page);
    const back = await page.evaluate(() => {
      state.legs[0].vorRef = 'BGN';
      const saved = serializeRoute();                       // what the library stores
      state.waypoints = []; state.legs = []; syncLegs();
      applyRouteData(JSON.parse(JSON.stringify(saved)));     // ...and loads back
      return state.legs.map(l => l.vorRef || null);
    });
    expect(back).toEqual(['BGN', null]);
  });

  test('the flight-plan picker writes through to storage, not just the modal', async ({ page }) => {
    await boot(page);
    await route(page);
    await page.locator('#plan').click();
    await page.locator('.modal-back').waitFor();
    await page.locator('#fp-vor-select').selectOption('NAT');       // global default
    const headers = await page.locator('.flight-table thead th').allTextContents();
    const radialIdx = headers.indexOf('Radial');
    const firstRow = page.locator('.flight-table tbody tr').first();
    // Let any debounced write already scheduled by the GLOBAL select land and clear, then
    // remove the blob. Otherwise that pending timer writes the leg's value for us and the
    // test passes even unfixed — the snapshot's object spread carries vorRef either way.
    await page.waitForTimeout(800);
    await page.evaluate(() => localStorage.removeItem('navaid.route'));
    await firstRow.locator('td').nth(radialIdx).locator('select.fp-leg-vor').selectOption('BGN');
    expect(await page.evaluate(() => state.legs[0].vorRef)).toBe('BGN');
    // The handler used to refresh the modal and nothing else: no draw(), no persist(), so
    // nothing was written at all and closing the plan lost a choice just made.
    await page.waitForFunction(() => {
      try {
        const raw = localStorage.getItem('navaid.route');
        return !!raw && JSON.parse(raw).legs[0].vorRef === 'BGN';
      } catch (e) { return false; }
    }, null, { timeout: 4000 });
  });

  test('a junk vorRef is dropped rather than stored', async ({ page }) => {
    await boot(page);
    await route(page);
    const out = await page.evaluate(() => {
      const load = v => {
        const d = serializeRoute();
        d.legs[0].vorRef = v;
        state.waypoints = []; state.legs = []; syncLegs();
        applyRouteData(d);
        return state.legs[0].vorRef === undefined ? null : state.legs[0].vorRef;
      };
      return { num: load(42), obj: load({ ident: 'BGN' }), long: load('X'.repeat(40)),
        blank: load('   '), lower: load('bgn') };
    });
    expect(out.num).toBeNull();
    expect(out.obj).toBeNull();
    expect(out.long).toBeNull();
    expect(out.blank).toBeNull();
    // A hand-edited file in lower case is still a legitimate ident.
    expect(out.lower).toBe('BGN');
  });

  test('an unknown ident is kept, and falls back to the global VOR to display', async ({ page }) => {
    await boot(page);
    await route(page);
    const out = await page.evaluate(() => {
      const d = serializeRoute();
      d.legs[0].vorRef = 'ZZZ';                    // e.g. a route saved against older nav data
      state.waypoints = []; state.legs = []; syncLegs();
      applyRouteData(d);
      return { kept: state.legs[0].vorRef, resolves: !!vorByIdent('ZZZ') };
    });
    // Dropping it would silently rewrite the pilot's file; keeping it means the value
    // reappears if that station comes back. legVorObj() already falls back to display.
    expect(out.kept).toBe('ZZZ');
    expect(out.resolves).toBe(false);
  });
});

test.describe('dragged cumulative-time kites survive a reload', () => {
  test('both the inbound and the return kite offsets are restored', async ({ page }) => {
    await boot(page);
    await route(page);
    await page.evaluate(() => {
      // What a drag leaves behind: an explicit offset with no _default flag.
      state.legs[0].cumLabel = { a: 12, p: -8, _m: 1 };
      state.legs[0].cumLabelRet = { a: -20, p: 6, _m: 1 };
      persist(); writeRoute();
    });
    const stored = await page.evaluate(() => {
      const l = JSON.parse(localStorage.getItem('navaid.route')).legs[0];
      return { cum: l.cumLabel, ret: l.cumLabelRet };
    });
    expect(stored.cum).toMatchObject({ a: 12, p: -8 });
    expect(stored.ret).toMatchObject({ a: -20, p: 6 });
    await page.reload();
    await page.waitForFunction(() => state.legs.length === 2);
    // restoreRoute() rebuilt the leg without either field, so drawing fell back to the
    // default position — reintroducing exactly the overlap the pilot moved out of the way.
    const after = await page.evaluate(() => ({
      cum: state.legs[0].cumLabel, ret: state.legs[0].cumLabelRet }));
    expect(after.cum).toMatchObject({ a: 12, p: -8, _m: 1 });
    expect(after.ret).toMatchObject({ a: -20, p: 6, _m: 1 });
    expect(after.cum._default).toBeUndefined();
    expect(after.ret._default).toBeUndefined();
  });

  test('a leg with no dragged kite still reloads as a default one', async ({ page }) => {
    await boot(page);
    await route(page);
    await page.evaluate(() => { persist(); writeRoute(); });
    await page.reload();
    await page.waitForFunction(() => state.legs.length === 2);
    const after = await page.evaluate(() => ({
      cum: state.legs[0].cumLabel, ret: state.legs[0].cumLabelRet }));
    // The default has to be present and flagged, matching the file/library path — a
    // bare undefined would make draw() and the drag code branch differently by origin.
    expect(after.cum).toMatchObject({ a: 0, _default: 1, _m: 1 });
    expect(after.ret).toMatchObject({ a: 0, _default: 1, _m: 1 });
  });
});
