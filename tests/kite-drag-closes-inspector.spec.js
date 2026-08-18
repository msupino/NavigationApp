// @ts-check
// Reported: dragging a nav kite or a cumulative-time kite left the inspector open over the
// chart. A press cannot be told from a drag until the release, so the panel now waits for it:
// nothing opens on the way down, a tap opens it (pressing a kite is how a leg is inspected),
// and a drag ends with the panel still shut, as a moved waypoint drag already did. Opening
// on the press and closing on the release — the first attempt — flashed the panel instead.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && typeof hitCumLabel === 'function' &&
    typeof endMouseDrag === 'function');
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.00, lng: 34.80, name: 'A' },
      { lat: 32.30, lng: 35.10, name: 'B' },
    ];
    syncLegs();
    showCumTime = true;
    map.setView([32.15, 34.95], 10);
    draw();
  });
}

const inspectorOpen = (page) => page.evaluate(() =>
  !document.getElementById('inspector').classList.contains('hidden'));

// Centre of the inbound cumulative kite as the renderer paints it.
const cumCentre = (page) => page.evaluate(() => {
  const seen = [];
  const orig = window.drawCumTimeArrow;
  window.drawCumTimeArrow = (x, y, ...rest) => { seen.push({ x, y }); return orig.call(null, x, y, ...rest); };
  draw();
  window.drawCumTimeArrow = orig;
  return seen[0];
});

// A mouse press at (x, y), an optional move, then release — through the real handlers.
const pressDragRelease = (page, x, y, dx, dy) => page.evaluate(([px, py, mx, my]) => {
  const p0 = L.point(px, py);
  map.fire('mousedown', { containerPoint: p0, latlng: map.containerPointToLatLng(p0) });
  if (mx || my) {
    const p1 = L.point(px + mx, py + my);
    map.fire('mousemove', { containerPoint: p1, latlng: map.containerPointToLatLng(p1) });
  }
  endMouseDrag();
}, [x, y, dx, dy]);

test('a tap on the cumulative kite opens the leg panel — on release, not before', async ({ page }) => {
  await boot(page);
  const c = await cumCentre(page);
  const whileDown = await page.evaluate(([x, y]) => {
    const p0 = L.point(x, y);
    map.fire('mousedown', { containerPoint: p0, latlng: map.containerPointToLatLng(p0) });
    return !document.getElementById('inspector').classList.contains('hidden');
  }, [c.x, c.y]);
  expect(whileDown).toBe(false);          // no flash on the way down
  await page.evaluate(() => endMouseDrag());
  expect(await inspectorOpen(page)).toBe(true);
  expect(await page.evaluate(() => state.selected && state.selected.type)).toBe('leg');
});

test('dragging the cumulative kite never opens it at all', async ({ page }) => {
  await boot(page);
  const c = await cumCentre(page);
  const seenOpen = await page.evaluate(([x, y]) => {
    const p0 = L.point(x, y);
    let open = false;
    const check = () => { open = open || !document.getElementById('inspector').classList.contains('hidden'); };
    map.fire('mousedown', { containerPoint: p0, latlng: map.containerPointToLatLng(p0) });
    check();
    const p1 = L.point(x + 45, y - 35);
    map.fire('mousemove', { containerPoint: p1, latlng: map.containerPointToLatLng(p1) });
    check();
    endMouseDrag();
    return open;
  }, [c.x, c.y]);
  expect(seenOpen).toBe(false);
  expect(await inspectorOpen(page)).toBe(false);
  // The leg stays selected, as a dragged waypoint stays selected on this path -- the
  // highlight is how the pilot sees what was just moved. Only the panel is withheld.
  expect(await page.evaluate(() => state.selected && state.selected.type)).toBe('leg');
});

test('dragging a nav kite leaves it shut too', async ({ page }) => {
  await boot(page);
  const hit = await page.evaluate(() => {
    // Walk the leg's midpoint neighbourhood for wherever the nav kite actually is.
    const a = proj(state.waypoints[0]), b = proj(state.waypoints[1]);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    for (let r = 0; r <= 160; r += 4) {
      for (let t = 0; t < 360; t += 15) {
        const x = mx + r * Math.cos(t * Math.PI / 180);
        const y = my + r * Math.sin(t * Math.PI / 180);
        if (hitLegLabel(x, y)) return { x, y };
      }
    }
    return null;
  });
  expect(hit).not.toBeNull();
  await pressDragRelease(page, hit.x, hit.y, 40, 30);
  expect(await inspectorOpen(page)).toBe(false);
});

test('the touch path agrees: a moved kite drag ends shut', async ({ page }) => {
  await boot(page);
  const c = await cumCentre(page);
  const out = await page.evaluate(([x, y]) => {
    touchDrag = { kind: 'cumlabel', i: 0, moved: true, startX: x, startY: y };
    state.selected = { type: 'leg', index: 0 };
    showInspector();
    const openedDuring = !document.getElementById('inspector').classList.contains('hidden');
    endTouch();
    return { openedDuring, after: !document.getElementById('inspector').classList.contains('hidden') };
  }, [c.x, c.y]);
  expect(out.openedDuring).toBe(true);
  expect(out.after).toBe(false);
});

// The waypoint rule has a third case, and kites follow it: a panel the pilot already had
// open is not taken away by a drag — it refreshes onto whatever is now selected.
test('a panel already open before the drag stays open', async ({ page }) => {
  await boot(page);
  const c = await cumCentre(page);
  const out = await page.evaluate(([x, y]) => {
    state.selected = { type: 'wp', index: 0 };
    showInspector();                                   // open before the gesture starts
    const p0 = L.point(x, y);
    map.fire('mousedown', { containerPoint: p0, latlng: map.containerPointToLatLng(p0) });
    const p1 = L.point(x + 40, y + 30);
    map.fire('mousemove', { containerPoint: p1, latlng: map.containerPointToLatLng(p1) });
    endMouseDrag();
    return !document.getElementById('inspector').classList.contains('hidden');
  }, [c.x, c.y]);
  expect(out).toBe(true);
});

// The complaint that started this: on the touch path the panel opened on the press and was
// hidden again on the first movement, so every drag flashed it across the map. Nothing may
// open mid-gesture, for anything draggable.
test('no press anywhere opens the panel before the release', async ({ page }) => {
  await boot(page);
  const c = await cumCentre(page);
  const spots = await page.evaluate(([cx, cy]) => {
    const wp = proj(state.waypoints[0]);
    return { wp: { x: wp.x, y: wp.y }, cum: { x: cx, y: cy } };
  }, [c.x, c.y]);
  for (const spot of [spots.wp, spots.cum]) {
    const openDuring = await page.evaluate(([x, y]) => {
      const insp = document.getElementById('inspector');
      state.selected = null; showInspector();          // start from a shut panel
      const p0 = L.point(x, y);
      map.fire('mousedown', { containerPoint: p0, latlng: map.containerPointToLatLng(p0) });
      const afterDown = !insp.classList.contains('hidden');
      const p1 = L.point(x + 50, y + 40);
      map.fire('mousemove', { containerPoint: p1, latlng: map.containerPointToLatLng(p1) });
      const afterMove = !insp.classList.contains('hidden');
      endMouseDrag();
      return afterDown || afterMove;
    }, [spot.x, spot.y]);
    expect(openDuring).toBe(false);
  }
});

// Notes have a second grab path (interact.js grabSelected): pressing a note that is ALREADY
// selected picks it straight up, and that path opened the panel on the press too.
test('pressing an already-selected note opens nothing until the release', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const insp = document.getElementById('inspector');
    state.notes.push({ lat: 32.15, lng: 34.95, text: 'X', color: '#000', shape: 'rect' });
    state.selected = { type: 'note', index: state.notes.length - 1 };
    draw();
    showInspector();
    insp.classList.add('hidden');                       // start shut, note still selected
    const q = proj(state.notes[state.notes.length - 1]);
    const p0 = L.point(q.x, q.y);
    map.fire('mousedown', { containerPoint: p0, latlng: map.containerPointToLatLng(p0) });
    const afterDown = !insp.classList.contains('hidden');
    endMouseDrag();                                     // released without moving: a tap
    return { afterDown, afterUp: !insp.classList.contains('hidden') };
  });
  expect(out.afterDown).toBe(false);
  expect(out.afterUp).toBe(true);
});

// Touch must follow the same rule as the mouse: a panel the pilot already had open is not
// taken away by a drag. The touch path hides the panel FOR the drag, so by the release the
// hidden class can no longer answer "was it up before?" — the answer is stamped at touchstart.
test('touch keeps a pre-gesture panel open, as the mouse path does', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const insp = document.getElementById('inspector');
    state.selected = { type: 'wp', index: 0 };
    showInspector();
    const openBefore = !insp.classList.contains('hidden');
    touchDrag = { kind: 'cumlabel', i: 0, moved: true, startX: 10, startY: 10, inspWasOpen: true };
    setInspectorDragHidden(true);                 // as a real touchmove does
    endTouch();
    return { openBefore, openAfter: !insp.classList.contains('hidden'),
             dragHidden: insp.classList.contains('insp-drag-hidden') };
  });
  expect(out.openBefore).toBe(true);
  expect(out.openAfter).toBe(true);
  expect(out.dragHidden).toBe(false);
});

test('touch still leaves a shut panel shut after a drag', async ({ page }) => {
  await boot(page);
  const after = await page.evaluate(() => {
    const insp = document.getElementById('inspector');
    state.selected = null; showInspector();
    touchDrag = { kind: 'cumlabel', i: 0, moved: true, startX: 10, startY: 10, inspWasOpen: false };
    endTouch();
    return !insp.classList.contains('hidden');
  });
  expect(after).toBe(false);
});
