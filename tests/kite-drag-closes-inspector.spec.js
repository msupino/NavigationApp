// @ts-check
// Reported: dragging a nav kite or a cumulative-time kite left the inspector open over the
// chart. Grabbing a kite opens its leg's panel — a press on one is a request to inspect the
// leg — but the moment that press becomes a drag it is not: the pilot is placing a label and
// the panel is covering the ground being worked on. A moved kite drag now ends shut, the way
// a moved waypoint drag already did. A press that never moves still opens the panel.
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

test('a press on the cumulative kite opens the leg panel', async ({ page }) => {
  await boot(page);
  const c = await cumCentre(page);
  await pressDragRelease(page, c.x, c.y, 0, 0);
  expect(await inspectorOpen(page)).toBe(true);
  expect(await page.evaluate(() => state.selected && state.selected.type)).toBe('leg');
});

test('dragging the cumulative kite leaves it shut', async ({ page }) => {
  await boot(page);
  const c = await cumCentre(page);
  await pressDragRelease(page, c.x, c.y, 45, -35);
  expect(await inspectorOpen(page)).toBe(false);
  expect(await page.evaluate(() => state.selected)).toBeNull();
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
