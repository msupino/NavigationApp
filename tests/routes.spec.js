// @ts-check
// End-to-end coverage of the route editing surface: add / drag / delete
// waypoints, reverse, clear, mode switching, inspector. Same 11-WP
// LLHZ → LLHA fixture as tests/flight-plan.spec.js and tests/share-route.spec.js.
const { test, expect } = require('./_setup');
const { enableShowReturn } = require('./_show-return');
const { LLHZ, LLHA } = require('./_airfieldArp');
const { hideToolbarMenus } = require('./_toolbar');

const ROUTE = {
  waypoints: [
    { lat: LLHZ.lat, lng: LLHZ.lng, name: 'LLHZ' },
    { lat: 32.21861, lng: 34.88250, name: 'BAZRA' },
    { lat: 32.25722, lng: 34.89111, name: 'DEROR' },
    { lat: 32.32306, lng: 34.90389, name: 'SHARO' },
    { lat: 32.46472, lng: 34.91222, name: 'HADRA' },
    { lat: 32.59194, lng: 34.94639, name: 'FRDIS' },
    { lat: 32.71444, lng: 34.97083, name: 'BOREN' },
    { lat: 32.75389, lng: 34.93694, name: 'HOTRM' },
    { lat: 32.79611, lng: 34.94333, name: 'DAROM' },
    { lat: 32.84111, lng: 34.98111, name: 'GALIM' },
    { lat: LLHA.lat, lng: LLHA.lng, name: 'LLHA' },
  ],
};

// Sentinel so the init script only clears storage on the FIRST navigation —
// subsequent reload()s in a single test see the persisted state intact.
async function setupCleanInit(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_init_v1') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build','view','display','charts','export','print']) {
          localStorage.setItem('navaid.sec.' + s, '1');
        }
        localStorage.setItem('__test_init_v1', '1');
      }
    } catch (e) {}
  });
}

async function bootWithRoute(page) {
  await setupCleanInit(page);
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof syncLegs === 'function');
  await page.evaluate(route => {
    state.waypoints = route.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
    state.notes = [];
    state.selected = null;
    state.mode = null;
    syncLegs();
    draw();
  }, ROUTE);
}

async function pickLegOnlyPoint(page) {
  return page.evaluate(() => {
    map.setView([32.3, 34.9], 10);
    draw();
    let picked = null;
    for (let i = 0; i < state.legs.length && !picked; i++) {
      const a = proj(state.waypoints[i]);
      const b = proj(state.waypoints[i + 1]);
      for (const t of [0.35, 0.45, 0.55, 0.65]) {
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        if (hitLeg(x, y) === i &&
            hitNote(x, y) < 0 &&
            !hitWaypointCandidates(x, y).length &&
            !hitCumLabel(x, y) &&
            !hitCumLabelRet(x, y) &&
            !hitLegLabel(x, y) &&
            !hitOverlayMarkerCandidates(x, y).length) {
          picked = { x, y, legIndex: i };
          break;
        }
      }
    }
    if (!picked) throw new Error('No leg-only click point found');
    const rect = map.getContainer().getBoundingClientRect();
    const clientX = Math.round(rect.left + picked.x);
    const clientY = Math.round(rect.top + picked.y);
    const ll = map.containerPointToLatLng([clientX - rect.left, clientY - rect.top]);
    return {
      x: clientX,
      y: clientY,
      legIndex: picked.legIndex,
      lat: r5(ll.lat),
      lng: r5(ll.lng),
      before: {
        waypoints: state.waypoints.length,
        legs: state.legs.length,
        notes: state.notes.length,
      },
    };
  });
}

test.describe('Add waypoint', () => {
  test.beforeEach(async ({ page }) => {
    await setupCleanInit(page);
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof state !== 'undefined' && typeof map !== 'undefined');
  });

  test('Add mode button toggles state.mode', async ({ page }) => {
    expect(await page.evaluate(() => state.mode)).toBeNull();
    await page.locator('#tool-add').click();
    expect(await page.evaluate(() => state.mode)).toBe('add');
    await page.locator('#tool-add').click();
    expect(await page.evaluate(() => state.mode)).toBeNull();
  });

  test('Click in add mode drops a waypoint', async ({ page }) => {
    await page.evaluate(() => { state.mode = 'add'; });
    await page.evaluate(() => map.fire('click', { latlng: L.latLng(32.5, 35.0) }));
    const wps = await page.evaluate(() => state.waypoints.length);
    expect(wps).toBe(1);
  });

  test('Two clicks build one leg', async ({ page }) => {
    await page.evaluate(() => { state.mode = 'add'; });
    await page.evaluate(() => {
      map.fire('click', { latlng: L.latLng(32.5, 35.0) });
      map.fire('click', { latlng: L.latLng(32.7, 35.2) });
    });
    const { wps, legs } = await page.evaluate(() => ({
      wps: state.waypoints.length, legs: state.legs.length,
    }));
    expect(wps).toBe(2);
    expect(legs).toBe(1);
  });

  test('Switching to note mode disables add mode', async ({ page }) => {
    await page.locator('#tool-add').click();
    await page.locator('#tool-note').click();
    expect(await page.evaluate(() => state.mode)).toBe('note');
  });
});

test.describe('Edit / delete waypoint', () => {
  test.beforeEach(async ({ page }) => bootWithRoute(page));

  test('deleteWaypoint(k) trims both arrays and keeps legs.length = wp.length - 1',
    async ({ page }) => {
      // Delete waypoint #5 (FRDIS)
      await page.evaluate(() => { deleteWaypoint(5); draw(); });
      const { wps, legs, name } = await page.evaluate(() => ({
        wps: state.waypoints.length, legs: state.legs.length,
        name: state.waypoints[5] ? state.waypoints[5].name : null,
      }));
      expect(wps).toBe(10);
      expect(legs).toBe(9);
      expect(name).toBe('BOREN');         // BOREN shifted into slot 5
    });

  test('Deleting first waypoint shifts entire array down', async ({ page }) => {
    await page.evaluate(() => { deleteWaypoint(0); draw(); });
    const first = await page.evaluate(() => state.waypoints[0].name);
    expect(first).toBe('BAZRA');
  });

  test('Deleting last waypoint trims tail', async ({ page }) => {
    await page.evaluate(() => { deleteWaypoint(state.waypoints.length - 1); draw(); });
    const last = await page.evaluate(() => state.waypoints[state.waypoints.length - 1].name);
    expect(last).toBe('GALIM');
  });

  test('Inspector Delete button removes the selected waypoint', async ({ page }) => {
    await page.evaluate(() => {
      state.selected = { type: 'wp', index: 4 };       // HADRA
      showInspector(); draw();
    });
    page.once('dialog', d => d.accept());              // safety: no confirm currently
    await page.locator('.insp-btn').filter({ hasText: /Delete waypoint/ }).click();
    const names = await page.evaluate(() => state.waypoints.map(w => w.name));
    expect(names).not.toContain('HADRA');
    expect(names).toHaveLength(10);
  });

  test('Editing inspector waypoint-name row updates state.waypoints[i].name', async ({ page }) => {
    await page.evaluate(() => {
      state.selected = { type: 'wp', index: 1 };
      showInspector();
    });
    const nameInput = page.locator('#insp-body .row input[type="text"]').first();
    await nameInput.fill('CUSTOM');
    expect(await page.evaluate(() => state.waypoints[1].name)).toBe('CUSTOM');
  });
});

test.describe('Split leg', () => {
  test.beforeEach(async ({ page }) => bootWithRoute(page));

  test('splitLegAt inserts a blank waypoint and preserves the old leg values', async ({ page }) => {
    const out = await page.evaluate(() => {
      const idx = 2;
      Object.assign(state.legs[idx], {
        inboundAltitude: 1234,
        outboundAltitude: 2345,
        flightSpeed: 111,
        outboundSpeed: 122,
        vorRef: 'NAT',
        _legAltitudeOutboundBlocked: 1,
        _legAltitudeOneWay: 1,
        inLabel: { a: 12, p: 3, _m: 1 },
        outLabel: { a: -8, p: -4, _m: 1 },
        cumLabel: { a: 6, p: 2, _m: 1 },
        cumLabelRet: { a: -6, p: -2, _m: 1 },
      });
      const before = { waypoints: state.waypoints.length, legs: state.legs.length };
      const ok = splitLegAt(idx, { lat: 32.3456789, lng: 34.9876543 });
      const fields = leg => ({
        inboundAltitude: leg.inboundAltitude,
        outboundAltitude: leg.outboundAltitude,
        flightSpeed: leg.flightSpeed,
        outboundSpeed: leg.outboundSpeed,
        vorRef: leg.vorRef,
        outboundBlocked: Boolean(leg._legAltitudeOutboundBlocked),
        oneWay: Boolean(leg._legAltitudeOneWay),
        inLabel: leg.inLabel,
        outLabel: leg.outLabel,
        cumLabel: leg.cumLabel,
        cumLabelRet: leg.cumLabelRet,
      });
      return {
        ok,
        before,
        after: { waypoints: state.waypoints.length, legs: state.legs.length },
        inserted: state.waypoints[idx + 1],
        selected: state.selected,
        inspectorName: document.querySelector('#insp-body .row input[type="text"]')?.value || '',
        first: fields(state.legs[idx]),
        second: fields(state.legs[idx + 1]),
      };
    });

    expect(out.ok).toBe(true);
    expect(out.after).toEqual({
      waypoints: out.before.waypoints + 1,
      legs: out.before.legs + 1,
    });
    expect(out.after.legs).toBe(out.after.waypoints - 1);
    expect(out.inserted).toMatchObject({ lat: 32.34568, lng: 34.98765, name: '' });
    expect(out.inserted._defaultWpName).toBe(1);
    expect(out.selected).toEqual({ type: 'wp', index: 3 });
    expect(out.inspectorName).toBe('WP 4');
    for (const leg of [out.first, out.second]) {
      expect(leg).toMatchObject({
        inboundAltitude: 1234,
        outboundAltitude: 2345,
        flightSpeed: 111,
        outboundSpeed: 122,
        vorRef: 'NAT',
        outboundBlocked: true,
        oneWay: true,
      });
      expect(leg.inLabel).toEqual({ a: 0, _default: 1, _m: 1 });
      expect(leg.outLabel).toEqual({ a: 0, _default: 1, _m: 1 });
      expect(leg.cumLabel).toEqual({ a: 0, _default: 1, _m: 1 });
      expect(leg.cumLabelRet).toEqual({ a: 0, _default: 1, _m: 1 });
    }
  });

  test('single-clicking a leg still only selects it', async ({ page }) => {
    const pos = await page.evaluate(() => {
      map.setView([32.3, 34.9], 10);
      draw();
      let picked = null;
      for (let i = 0; i < state.legs.length && !picked; i++) {
        const a = proj(state.waypoints[i]);
        const b = proj(state.waypoints[i + 1]);
        for (const t of [0.35, 0.45, 0.55, 0.65]) {
          const x = a.x + (b.x - a.x) * t;
          const y = a.y + (b.y - a.y) * t;
          if (hitLeg(x, y) === i &&
              hitNote(x, y) < 0 &&
              !hitWaypointCandidates(x, y).length &&
              !hitCumLabel(x, y) &&
              !hitCumLabelRet(x, y) &&
              !hitLegLabel(x, y) &&
              !hitOverlayMarkerCandidates(x, y).length) {
            picked = { x, y, legIndex: i };
            break;
          }
        }
      }
      if (!picked) throw new Error('No leg-only click point found');
      const rect = map.getContainer().getBoundingClientRect();
      return {
        x: rect.left + picked.x,
        y: rect.top + picked.y,
        legIndex: picked.legIndex,
        before: { waypoints: state.waypoints.length, legs: state.legs.length },
      };
    });
    await page.mouse.click(pos.x, pos.y);
    const after = await page.evaluate(() => ({
      waypoints: state.waypoints.length,
      legs: state.legs.length,
      selected: state.selected,
    }));
    expect(after.waypoints).toBe(pos.before.waypoints);
    expect(after.legs).toBe(pos.before.legs);
    expect(after.selected).toEqual({ type: 'leg', index: pos.legIndex });
  });

  test('double-clicking a leg splits it at the clicked point', async ({ page }) => {
    const pos = await pickLegOnlyPoint(page);
    await page.mouse.dblclick(pos.x, pos.y);
    const after = await page.evaluate(legIndex => ({
      waypoints: state.waypoints.length,
      legs: state.legs.length,
      inserted: state.waypoints[legIndex + 1],
      selected: state.selected,
      inspectorName: document.querySelector('#insp-body .row input[type="text"]')?.value || '',
    }), pos.legIndex);
    expect(after.waypoints).toBe(pos.before.waypoints + 1);
    expect(after.legs).toBe(pos.before.legs + 1);
    expect(after.legs).toBe(after.waypoints - 1);
    expect(after.inserted).toMatchObject({ lat: pos.lat, lng: pos.lng, name: '' });
    expect(after.inserted._defaultWpName).toBe(1);
    expect(after.selected).toEqual({ type: 'wp', index: pos.legIndex + 1 });
    expect(after.inspectorName).toBe(`WP ${pos.legIndex + 2}`);
  });

  test('double-clicking a leg over a visible map waypoint still splits it', async ({ page }) => {
    const pos = await page.evaluate(async () => {
      await loadNavWaypoints();
      showNavWP = true;
      const point = navWP.find(w => w.name === 'DEROR');
      if (!point) throw new Error('DEROR not loaded');
      state.waypoints = [
        { lat: r5(point.lat - 0.08), lng: r5(point.lng), name: 'WP A' },
        { lat: r5(point.lat + 0.08), lng: r5(point.lng), name: 'WP B' },
      ];
      state.notes = [];
      state.selected = null;
      state.mode = null;
      syncLegs();
      map.setView([point.lat, point.lng], 10);
      draw();
      const p = proj(point);
      const ll = map.containerPointToLatLng([p.x, p.y]);
      const rect = map.getContainer().getBoundingClientRect();
      return {
        x: rect.left + p.x,
        y: rect.top + p.y,
        lat: r5(ll.lat),
        lng: r5(ll.lng),
        legIndex: hitLeg(p.x, p.y),
        routeHits: hitWaypointCandidates(p.x, p.y).length,
        overlayHits: hitOverlayMarkerCandidates(p.x, p.y).map(h => h.type),
        before: { waypoints: state.waypoints.length, legs: state.legs.length },
      };
    });
    expect(pos.legIndex).toBe(0);
    expect(pos.routeHits).toBe(0);
    expect(pos.overlayHits).toContain('navwp');

    // bootWithRoute presets every toolbar section open, and in desktop menu-bar mode
    // those dropdowns overlay the map — including the centre point this test
    // double-clicks, so the gesture never reached the canvas. Same flake family the
    // helper's own comment describes.
    await hideToolbarMenus(page);
    await page.mouse.dblclick(pos.x, pos.y);
    const after = await page.evaluate(() => ({
      waypoints: state.waypoints.length,
      legs: state.legs.length,
      inserted: state.waypoints[1],
      selected: state.selected,
      inspectorName: document.querySelector('#insp-body .row input[type="text"]')?.value || '',
    }));
    expect(after.waypoints).toBe(pos.before.waypoints + 1);
    expect(after.legs).toBe(pos.before.legs + 1);
    expect(after.legs).toBe(after.waypoints - 1);
    expect(after.inserted).toMatchObject({ lat: pos.lat, lng: pos.lng, name: '' });
    expect(after.inserted._defaultWpName).toBe(1);
    expect(after.selected).toEqual({ type: 'wp', index: 1 });
    expect(after.inspectorName).toBe('WP 2');
  });

  for (const mode of ['add', 'note']) {
    test(`double-clicking a leg splits it while ${mode} mode is active`, async ({ page }) => {
      await page.evaluate(nextMode => { state.mode = nextMode; }, mode);
      const pos = await pickLegOnlyPoint(page);
      await page.mouse.dblclick(pos.x, pos.y);
      const after = await page.evaluate(legIndex => ({
        mode: state.mode,
        waypoints: state.waypoints.length,
        legs: state.legs.length,
        notes: state.notes.length,
        inserted: state.waypoints[legIndex + 1],
        selected: state.selected,
      }), pos.legIndex);
      expect(after.mode).toBe(mode);
      expect(after.waypoints).toBe(pos.before.waypoints + 1);
      expect(after.legs).toBe(pos.before.legs + 1);
      expect(after.notes).toBe(pos.before.notes);
      expect(after.inserted).toMatchObject({ lat: pos.lat, lng: pos.lng, name: '' });
      expect(after.inserted._defaultWpName).toBe(1);
      expect(after.selected).toEqual({ type: 'wp', index: pos.legIndex + 1 });
    });
  }

  test('double-clicking away from a leg does not split the route', async ({ page }) => {
    const pos = await page.evaluate(() => {
      map.setView([32.3, 34.9], 10);
      draw();
      const rect = map.getContainer().getBoundingClientRect();
      const candidates = [
        [24, 24],
        [rect.width - 24, 24],
        [24, rect.height - 24],
        [rect.width - 24, rect.height - 24],
      ];
      const pick = candidates.find(([x, y]) =>
        hitLeg(x, y) < 0 &&
        hitNote(x, y) < 0 &&
        !hitWaypointCandidates(x, y).length) || candidates[0];
      return {
        x: rect.left + pick[0],
        y: rect.top + pick[1],
        before: { waypoints: state.waypoints.length, legs: state.legs.length },
      };
    });
    await page.mouse.dblclick(pos.x, pos.y);
    const after = await page.evaluate(() => ({
      waypoints: state.waypoints.length,
      legs: state.legs.length,
    }));
    expect(after).toEqual(pos.before);
  });
});

test.describe('Point selection chooser', () => {
  test.beforeEach(async ({ page }) => {
    await setupCleanInit(page);
    await page.goto('?lang=en');
    await page.waitForFunction(() =>
      typeof state !== 'undefined' &&
      typeof createDraggableModal === 'function' &&
      typeof hitWaypointCandidates === 'function');
  });

  test('close route waypoints ask which point to select instead of changing zoom', async ({ page }) => {
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.2, lng: 34.9, name: 'FIRST' },
        { lat: 32.20001, lng: 34.90001, name: 'SECOND' },
      ];
      syncLegs();
      map.setView([32.2, 34.9], 12);
      draw();
    });
    const beforeZoom = await page.evaluate(() => map.getZoom());
    await page.evaluate(() => {
      const p = proj(state.waypoints[0]);
      map.fire('mousedown', {
        containerPoint: L.point(p.x, p.y),
        latlng: L.latLng(state.waypoints[0].lat, state.waypoints[0].lng),
      });
    });
    await expect(page.locator('.point-choice-modal')).toBeVisible();
    await expect(page.locator('.point-choice-option')).toHaveCount(2);
    await page.locator('.point-choice-option').filter({ hasText: 'SECOND' }).click();
    expect(await page.evaluate(() => state.selected)).toEqual({ type: 'wp', index: 1 });
    await expect(page.locator('#insp-title')).toHaveValue('SECOND');
    expect(await page.evaluate(() => map.getZoom())).toBe(beforeZoom);
  });
});

test.describe('Reverse route', () => {
  test.beforeEach(async ({ page }) => bootWithRoute(page));

  test('Reverse flips waypoint order', async ({ page }) => {
    await page.locator('#reverse').click();
    const names = await page.evaluate(() => state.waypoints.map(w => w.name));
    expect(names[0]).toBe('LLHA');
    expect(names[names.length - 1]).toBe('LLHZ');
  });

  test('Reverse twice is identity', async ({ page }) => {
    const before = await page.evaluate(() => state.waypoints.map(w => w.name));
    await page.locator('#reverse').click();
    await page.locator('#reverse').click();
    const after = await page.evaluate(() => state.waypoints.map(w => w.name));
    expect(after).toEqual(before);
  });

  test('Reverse swaps inbound and outbound altitudes per leg', async ({ page }) => {
    await page.evaluate(() => {
      state.legs.forEach((l, i) => {
        l.inboundAltitude = 1000 + i * 100;
        l.outboundAltitude = 2000 + i * 100;
        markLegAltitudeManual(i);
      });
    });
    await page.locator('#reverse').click();
    const result = await page.evaluate(() => state.legs.map(l => ({
      ia: l.inboundAltitude, oa: l.outboundAltitude,
    })));
    // Before reverse, leg 0 had ia=1000/oa=2000; after reverse it becomes the
    // last leg in array. Reversed legs swap ia↔oa: new leg-9 has ia=2000, oa=1000.
    expect(result[result.length - 1]).toEqual({ ia: 2000, oa: 1000 });
    expect(result[0]).toEqual({ ia: 2900, oa: 1900 });
  });

  test('legs.length stays consistent after reverse', async ({ page }) => {
    await page.locator('#reverse').click();
    const ok = await page.evaluate(() =>
      state.legs.length === state.waypoints.length - 1);
    expect(ok).toBe(true);
  });
});

test.describe('Clear map', () => {
  test.beforeEach(async ({ page }) => bootWithRoute(page));

  test('Clear button confirmation empties waypoints, legs, notes', async ({ page }) => {
    await page.evaluate(() => {
      state.notes.push({ lat: 32.5, lng: 35.0, text: 'X', color: '#ff0', shape: 'rect' });
    });
    page.once('dialog', d => d.accept());
    await page.locator('#clear').click();
    const sizes = await page.evaluate(() => ({
      wps: state.waypoints.length, legs: state.legs.length, notes: state.notes.length,
    }));
    expect(sizes).toEqual({ wps: 0, legs: 0, notes: 0 });
  });

  test('Dismissing the confirm keeps the route intact', async ({ page }) => {
    page.once('dialog', d => d.dismiss());
    await page.locator('#clear').click();
    const wps = await page.evaluate(() => state.waypoints.length);
    expect(wps).toBe(11);
  });
});

test.describe('Notes', () => {
  test.beforeEach(async ({ page }) => bootWithRoute(page));

  test('Adding a note via map click in note mode', async ({ page }) => {
    await page.evaluate(() => { state.mode = 'note'; });
    await page.evaluate(() => map.fire('click', { latlng: L.latLng(32.6, 34.95) }));
    const len = await page.evaluate(() => state.notes.length);
    expect(len).toBe(1);
  });

  test('Note round-trips through save/load schema', async ({ page }) => {
    await page.evaluate(() => {
      state.notes = [{ lat: 32.5, lng: 35.0, text: 'Hello', color: '#abcdef', shape: 'oval' }];
    });
    const errs = await page.evaluate(() => validateRoute({
      waypoints: state.waypoints, legs: state.legs, notes: state.notes,
    }));
    expect(errs).toBeNull();
  });

  test('Comm-change suppression metadata validates as optional string keys', async ({ page }) => {
    const out = await page.evaluate(() => ({
      valid: validateRoute({
        waypoints: [],
        legs: [],
        notes: [],
        commChangeSuppressions: ['TYONA'],
      }),
      invalid: validateRoute({
        waypoints: [],
        legs: [],
        notes: [],
        commChangeSuppressions: ['TYONA', 42],
      }),
    }));
    expect(out.valid).toBeNull();
    expect(out.invalid).toContain('root.commChangeSuppressions[1]: expected string');
  });

  test('Inspector deletes the selected note', async ({ page }) => {
    await page.evaluate(() => {
      state.notes = [
        { lat: 32.5, lng: 35.0, text: 'A', color: '#fff', shape: 'rect' },
        { lat: 32.6, lng: 35.1, text: 'B', color: '#fff', shape: 'rect' },
      ];
      state.selected = { type: 'note', index: 0 };
      showInspector(); draw();
    });
    page.once('dialog', d => d.accept());
    await page.locator('.insp-btn').filter({ hasText: /Delete note/ }).click();
    const remaining = await page.evaluate(() => state.notes.map(n => n.text));
    expect(remaining).toEqual(['B']);
  });
});

test.describe('Persistence', () => {
  test.beforeEach(async ({ page }) => bootWithRoute(page));

  test('Route auto-persists to localStorage and restores on reload', async ({ page }) => {
    // draw() schedules a 500 ms-debounced persist; the boot's empty-state draw
    // wins the timer slot before the bootWithRoute injection can register. Wait
    // out the first debounce window, then trigger a fresh draw so persist sees
    // the injected 11-WP route.
    await page.waitForTimeout(600);
    await page.evaluate(() => { draw(); });
    await page.waitForFunction(() => {
      const raw = localStorage.getItem('navaid.route');
      if (!raw) return false;
      try { return JSON.parse(raw).waypoints.length === 11; } catch (e) { return false; }
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() =>
      typeof state !== 'undefined' && state.waypoints && state.waypoints.length === 11);
    const names = await page.evaluate(() => state.waypoints.map(w => w.name));
    expect(names[0]).toBe('LLHZ');
    expect(names[names.length - 1]).toBe('LLHA');
  });

  test('Edits trigger an auto-save', async ({ page }) => {
    await page.waitForTimeout(600);          // let boot's debounced persist drain
    await page.evaluate(() => {
      state.waypoints[0].name = 'EDITED';
      draw();
    });
    await page.waitForFunction(() => {
      const raw = localStorage.getItem('navaid.route');
      return raw && raw.indexOf('EDITED') >= 0;
    });
  });
});

test.describe('JSON export / import round-trip', () => {
  test.beforeEach(async ({ page }) => bootWithRoute(page));

  test('save() then validateRoute(parsed) is null', async ({ page }) => {
    const errs = await page.evaluate(() => {
      const data = {
        waypoints: state.waypoints.map(w => ({ lat: w.lat, lng: w.lng, name: w.name || '' })),
        legs: state.legs.map(l => ({
          inboundAltitude: l.inboundAltitude,
          outboundAltitude: l.outboundAltitude,
          flightSpeed: l.flightSpeed,
          outboundSpeed: l.outboundSpeed,
          inLabel: l.inLabel, outLabel: l.outLabel,
        })),
        notes: [],
      };
      return validateRoute(data);
    });
    expect(errs).toBeNull();
  });
});

test.describe('Inspector close behaviour', () => {
  test.beforeEach(async ({ page }) => bootWithRoute(page));

  test('Empty-map click clears state.selected', async ({ page }) => {
    await page.evaluate(() => {
      state.selected = { type: 'wp', index: 0 };
      showInspector(); draw();
    });
    await page.evaluate(() => map.fire('click', { latlng: L.latLng(31.5, 35.5) }));
    expect(await page.evaluate(() => state.selected)).toBeNull();
  });

  test('Inspector close button clears selection', async ({ page }) => {
    await page.evaluate(() => {
      state.selected = { type: 'wp', index: 3 };
      showInspector();
    });
    await hideToolbarMenus(page);
    await page.locator('#insp-close').click();
    expect(await page.evaluate(() => state.selected)).toBeNull();
  });
});

test.describe('Layer picker', () => {
  test.beforeEach(async ({ page }) => bootWithRoute(page));

  test('Changing the layer persists to localStorage', async ({ page }) => {
    await page.locator('#layer-select').selectOption('OpenStreetMap');
    await page.waitForFunction(() =>
      localStorage.getItem('navaid.layer') === 'OpenStreetMap');
    expect(true).toBe(true);
  });

  test('Selected layer survives a page reload', async ({ page }) => {
    await page.locator('#layer-select').selectOption('OpenStreetMap');
    await page.waitForFunction(() =>
      localStorage.getItem('navaid.layer') === 'OpenStreetMap');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#layer-select')).toHaveValue('OpenStreetMap');
  });
});

test.describe('Overlay toggles', () => {
  test.beforeEach(async ({ page }) => bootWithRoute(page));

  test('Show nav waypoints toggle persists', async ({ page }) => {
    await page.locator('#navwp-cb').uncheck();
    await page.waitForFunction(() =>
      localStorage.getItem('navaid.showNavWP') === '0');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#navwp-cb')).not.toBeChecked();
  });

  test('Show airfields toggle persists', async ({ page }) => {
    await page.locator('#airfield-cb').uncheck();
    await page.waitForFunction(() =>
      localStorage.getItem('navaid.showAirfields') === '0');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#airfield-cb')).not.toBeChecked();
  });

  test('Show return path toggle persists while the feature is on', async ({ page }) => {
    await enableShowReturn(page);
    await page.locator('#ret-cb').check();
    await page.waitForFunction(() =>
      localStorage.getItem('navaid.showReturn') === '1');
    await page.reload({ waitUntil: 'domcontentloaded' });
    // The feature ships OFF, so boot deliberately clears the stored preference (see
    // refreshShowReturnFeature). Switch it back on the way a gist would, and the stored
    // '1' is what the control comes back as.
    await page.waitForFunction(() => typeof refreshShowReturnFeature === 'function');
    await enableShowReturn(page);
    await page.evaluate(() => {
      window.showReturn = localStorage.getItem('navaid.showReturn') === '1';
      refreshShowReturnFeature();
    });
    await expect(page.locator('#ret-cb')).toBeChecked();
  });

  test('a stored "on" cannot resurrect the return path while the feature is off', async ({ page }) => {
    // The other half of the same rule: someone who had it on before it was switched off
    // must not come back to a mirrored route with no control to stop it.
    await page.evaluate(() => localStorage.setItem('navaid.showReturn', '1'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof refreshShowReturnFeature === 'function');
    const out = await page.evaluate(() => ({
      showReturn: window.showReturn,
      checked: document.getElementById('ret-cb').checked,
      display: getComputedStyle(document.getElementById('ret-cb').closest('label')).display,
    }));
    expect(out.showReturn).toBe(false);
    expect(out.checked).toBe(false);
    expect(out.display).toBe('none');
  });
});

test.describe('syncLegs invariant', () => {
  test('legs.length always equals waypoints.length - 1', async ({ page }) => {
    await bootWithRoute(page);
    const after = async () => page.evaluate(() => state.legs.length === state.waypoints.length - 1);
    expect(await after()).toBe(true);
    await page.evaluate(() => { deleteWaypoint(0); });
    expect(await after()).toBe(true);
    await page.evaluate(() => { state.waypoints.push({ lat: 33, lng: 36, name: 'X' }); syncLegs(); });
    expect(await after()).toBe(true);
    await page.locator('#reverse').click();
    expect(await after()).toBe(true);
  });
});
