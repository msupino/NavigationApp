// @ts-check
// Coverage for the canvas-overlay drag + rotate maths that the pointer
// handlers sit on top of:
//  C2 — legLabelCenter()/hitLegLabel()/legFrame(): the kite-label hit test
//       returns {i,which} only when the cursor is on the rendered label,
//       and leg-label drags stay between the waypoint perpendicular gates.
//  C3 — the page frame is viewport-locked by default, so its border pans the map;
//       the gist switch restores the legacy draggable, clamped frame.
//  C6 — rotEnd(cycle): a tap (drag start, no move) steps the bearing through
//       0 -> 270 -> 180 -> 90 -> 0 (shown 0/90/180/270).
const { test, expect } = require('./_setup');
const { hideToolbarMenus } = require('./_toolbar');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() =>
    typeof legLabelCenter === 'function' &&
    typeof hitLegLabel === 'function' &&
    typeof hitPageFrameEdge === 'function' &&
    typeof clampPageOffset === 'function' &&
    typeof rotEnd === 'function' &&
    typeof state !== 'undefined' && typeof map !== 'undefined');
}

async function setRoute(page) {
  // Two waypoints a comfortable distance apart, then centre the map on the
  // pair so the leg is well inside the viewport and the label is on-screen.
  await page.evaluate(() => {
    state.waypoints = [
      { lat: 32.0, lng: 34.85, name: 'A' },
      { lat: 32.2, lng: 35.05, name: 'B' },
    ];
    syncLegs();
    map.setView([32.1, 34.95], 11);
    map.setBearing(0);
    draw();
  });
}

test.describe('Leg-label hit test (C2)', () => {
  test('hitLegLabel returns {i,which} at the rendered inbound label centre', async ({ page }) => {
    await boot(page);
    await setRoute(page);
    const hit = await page.evaluate(() => {
      const c = legLabelCenter(0, 'in');
      return { c, hit: hitLegLabel(c.x, c.y) };
    });
    expect(hit.c).not.toBeNull();
    expect(hit.hit).toEqual({ i: 0, which: 'in' });
  });

  test('hitLegLabel misses when the cursor is far from any label', async ({ page }) => {
    await boot(page);
    await setRoute(page);
    const miss = await page.evaluate(() => {
      const c = legLabelCenter(0, 'in');
      // 500 px away from the label centre — well outside the hit radius.
      return hitLegLabel(c.x + 500, c.y + 500);
    });
    expect(miss).toBeNull();
  });

  test('legLabelCenter returns null for a non-existent leg', async ({ page }) => {
    await boot(page);
    await setRoute(page);
    expect(await page.evaluate(() => legLabelCenter(9, 'in'))).toBeNull();
  });

  test('legFrame midpoint sits between the two projected waypoints', async ({ page }) => {
    await boot(page);
    await setRoute(page);
    const ok = await page.evaluate(() => {
      const a = proj(state.waypoints[0]);
      const b = proj(state.waypoints[1]);
      const f = legFrame(0);
      return Math.abs(f.mx - (a.x + b.x) / 2) < 1e-6 &&
             Math.abs(f.my - (a.y + b.y) / 2) < 1e-6;
    });
    expect(ok).toBe(true);
  });

  test('dragging a leg kite follows the limit-to-leg checkbox', async ({ page }) => {
    await boot(page);
    await setRoute(page);
    await hideToolbarMenus(page);
    await page.evaluate(() => {
      const cb = document.getElementById('limit-kites-cb');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      map.setZoom(12);
      draw();
    });
    await page.waitForFunction(() => Math.abs(map.getZoom() - 12) < 0.01);

    const dragPts = await page.evaluate(() => {
      const c = legLabelCenter(0, 'in');
      const f = legFrame(0);
      const r = map.getContainer().getBoundingClientRect();
      const perp = (c.x - f.mx) * f.nx + (c.y - f.my) * f.ny;
      const mapSize = map.getSize();
      const makeTarget = along => ({
        x: f.mx + f.dx * along + f.nx * perp,
        y: f.my + f.dy * along + f.ny * perp,
      });
      const withinMap = p =>
        p.x > 40 && p.y > 40 && p.x < mapSize.x - 40 && p.y < mapSize.y - 40;
      const overshootAlong = f.len / 2 + 40;
      const candidates = [overshootAlong, -overshootAlong];
      const targetAlong = candidates.find(along => withinMap(makeTarget(along))) || candidates[0];
      const fartherCandidate = Math.sign(targetAlong || 1) * (f.len / 2 + 70);
      const fartherAlong = withinMap(makeTarget(fartherCandidate)) ? fartherCandidate : targetAlong;
      const target = makeTarget(targetAlong);
      const farther = makeTarget(fartherAlong);
      return {
        start: { x: r.left + c.x, y: r.top + c.y },
        target: { x: r.left + target.x, y: r.top + target.y },
        farther: { x: r.left + farther.x, y: r.top + farther.y },
        targetAlong,
        targetSign: Math.sign(targetAlong || 1),
      };
    });

    await page.mouse.move(dragPts.start.x, dragPts.start.y);
    await page.mouse.down();
    await page.mouse.move(dragPts.target.x, dragPts.target.y, { steps: 8 });
    const clampedDuringDrag = await page.evaluate(() => {
      const f = legFrame(0);
      const c = legLabelCenter(0, 'in');
      return (c.x - f.mx) * f.dx + (c.y - f.my) * f.dy;
    });
    await page.mouse.move(dragPts.farther.x, dragPts.farther.y, { steps: 4 });
    const afterFurtherOvershoot = await page.evaluate(() => {
      const f = legFrame(0);
      const c = legLabelCenter(0, 'in');
      return (c.x - f.mx) * f.dx + (c.y - f.my) * f.dy;
    });
    await page.mouse.up();
    expect(afterFurtherOvershoot).toBeCloseTo(clampedDuringDrag, 1);

    const out = await page.evaluate(() => {
      const f = legFrame(0);
      const c = legLabelCenter(0, 'in');
      const sc = legZoomScale();                 // label.a is stored in this unit
      // The kite is drawn at kiteDrawScale (ground-sized), so its along-half —
      // used both for the clamp and the edge check — comes from that scale.
      const halfKitePx = legKiteAlongHalfPx(kiteDrawScale());
      const limit = Math.max(0, (f.len / 2 - halfKitePx) / sc);
      const alongPx = (c.x - f.mx) * f.dx + (c.y - f.my) * f.dy;
      return { label: state.legs[0].inLabel, limit, alongPx, halfPx: f.len / 2, halfKitePx };
    });
    expect(out.label._default).toBeUndefined();
    expect(out.label._m).toBe(1);
    expect(Math.abs(dragPts.targetAlong)).toBeGreaterThan(out.halfPx + 20);
    // Dragged past the leg end with limit-to-leg on → the kite's far edge stays
    // within the leg boundary (uses the kite's drawn along-half, kiteDrawScale).
    expect(Math.sign(out.label.a)).toBe(dragPts.targetSign);
    expect(Math.abs(out.alongPx) + out.halfKitePx).toBeLessThanOrEqual(out.halfPx + 1);

    const symmetric = await page.evaluate(() => {
      const leg = state.legs[0];
      const f = legFrame(0);
      const sc = legZoomScale();
      // Clamp limit uses the kite's DRAWN along-half (kiteDrawScale), divided
      // into the leg's own (legZoomScale) a-units.
      const limit = Math.max(0, (f.len / 2 - legKiteAlongHalfPx(kiteDrawScale())) / sc);
      leg.inLabel.a = 99999;
      leg.outLabel = { a: -99999, p: -30, _m: 1 };
      clampLegLabelAlong(0, leg.inLabel);
      clampLegLabelAlong(0, leg.outLabel);
      return { limit, inA: leg.inLabel.a, outA: leg.outLabel.a };
    });
    expect(symmetric.inA).toBeCloseTo(symmetric.limit, 6);
    expect(symmetric.outA).toBeCloseTo(-symmetric.limit, 6);

    await page.evaluate(() => {
      const cb = document.getElementById('limit-kites-cb');
      cb.checked = false;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      const f = legFrame(0);
      const sc = legZoomScale();
      state.legs[0].inLabel = { a: (f.len / 2 + 40) / sc, p: 30, _m: 1 };
      clampLegLabelAlong(0, state.legs[0].inLabel);
      draw();
    });
    const free = await page.evaluate(() => {
      const f = legFrame(0);
      const c = legLabelCenter(0, 'in');
      const alongPx = (c.x - f.mx) * f.dx + (c.y - f.my) * f.dy;
      return {
        checked: document.getElementById('limit-kites-cb').checked,
        stored: localStorage.getItem('navaid.limitLegKites'),
        alongPx,
        halfPx: f.len / 2,
      };
    });
    expect(free.checked).toBe(false);
    expect(free.stored).toBe('0');
    expect(free.alongPx).toBeGreaterThan(free.halfPx + 20);
  });
});

test.describe('Page-frame centre lock and legacy drag grip (C3)', () => {
  test('the default lock keeps the frame centred and removes its drag grip', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => {
      setPage('A4');
      pageOffset = { x: 180, y: -120 };
      const r = pageFrameRect();
      return {
        locked: tune('pageFrameLocked'),
        centre: { x: r.x + r.w / 2, y: r.y + r.h / 2 },
        viewport: { x: vw() / 2, y: vh() / 2 },
        onTopEdge: hitPageFrameEdge(r.x + r.w / 2, r.y),
      };
    });
    expect(out.locked).toBe(true);
    expect(out.centre.x).toBeCloseTo(out.viewport.x, 5);
    expect(out.centre.y).toBeCloseTo(out.viewport.y, 5);
    expect(out.onTopEdge).toBe(false);
  });

  test('the gist tune can restore the movable frame drag grip', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => {
      setTune('pageFrameLocked', false);
      setPage('A4');
      fitPageFrame();
      const r = pageFrameRect();
      return {
        onTopEdge: hitPageFrameEdge(r.x + r.w / 2, r.y),
        atCentre: hitPageFrameEdge(r.x + r.w / 2, r.y + r.h / 2),
      };
    });
    expect(out.onTopEdge).toBe(true);
    expect(out.atCentre).toBe(false);
  });

  test('dragging a locked frame edge pans the map under a centred frame', async ({ page }) => {
    await boot(page);
    const before = await page.evaluate(() => {
      state.waypoints = []; state.legs = []; state.notes = [];
      setPage('A4');
      const r = pageFrameRect();
      return { edge: { x: r.x + r.w / 2, y: r.y }, center: map.getCenter() };
    });
    await page.mouse.move(before.edge.x, before.edge.y);
    await page.mouse.down();
    await page.mouse.move(before.edge.x + 90, before.edge.y + 45, { steps: 5 });
    await page.mouse.up();
    const after = await page.evaluate(() => {
      const r = pageFrameRect();
      return {
        center: map.getCenter(),
        frameCentre: { x: r.x + r.w / 2, y: r.y + r.h / 2 },
        viewport: { x: vw() / 2, y: vh() / 2 },
        offset: pageOffset,
      };
    });
    expect(Math.abs(after.center.lat - before.center.lat) +
      Math.abs(after.center.lng - before.center.lng)).toBeGreaterThan(0.001);
    expect(after.frameCentre.x).toBeCloseTo(after.viewport.x, 5);
    expect(after.frameCentre.y).toBeCloseTo(after.viewport.y, 5);
    expect(after.offset).toEqual({ x: 0, y: 0 });
  });

  test('hitPageFrameEdge is false when no page frame is set', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      pageSize = null;
      return hitPageFrameEdge(10, 10);
    });
    expect(r).toBe(false);
  });

  test('clampPageOffset keeps the offset within +/- half the viewport', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => {
      pageOffset.x = 99999; pageOffset.y = -99999;
      clampPageOffset();
      return { off: pageOffset, vw: vw(), vh: vh() };
    });
    expect(out.off.x).toBeCloseTo(out.vw / 2, 5);
    expect(out.off.y).toBeCloseTo(-out.vh / 2, 5);
  });
});

test.describe('Rotate dial tap-step (C6)', () => {
  test('successive taps step the bearing 0 -> 270 -> 180 -> 90 -> 0', async ({ page }) => {
    await boot(page);
    const seq = await page.evaluate(() => {
      const out = [];
      map.setBearing(0);
      for (let i = 0; i < 4; i++) {
        rotDragging = true; rotMoved = false;   // simulate a clean tap
        rotEnd(true);
        out.push(Math.round(mapBearing()));
      }
      return out;
    });
    expect(seq).toEqual([270, 180, 90, 0]);
  });

  test('an aborted gesture (pointercancel) does not rotate', async ({ page }) => {
    await boot(page);
    const b = await page.evaluate(() => {
      map.setBearing(0);
      rotDragging = true; rotMoved = false;
      rotEnd(false);                 // cancel -> no step
      return Math.round(mapBearing());
    });
    expect(b).toBe(0);
  });
});
