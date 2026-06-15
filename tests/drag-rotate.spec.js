// @ts-check
// Coverage for the canvas-overlay drag + rotate maths that the pointer
// handlers sit on top of:
//  C2 — legLabelCenter()/hitLegLabel()/legFrame(): the kite-label hit test
//       returns {i,which} only when the cursor is on the rendered label,
//       and leg-label drags stay between the waypoint perpendicular gates.
//  C3 — hitPageFrameEdge()/clampPageOffset(): the page-frame border band is
//       grabbable; the centre is not; the drag offset is clamped on-screen.
//  C6 — rotEnd(cycle): a tap (drag start, no move) steps the bearing through
//       0 -> 270 -> 180 -> 90 -> 0 (shown 0/90/180/270).
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en');
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

  test('dragging a leg kite clamps along-leg movement between waypoint gates', async ({ page }) => {
    await boot(page);
    await setRoute(page);
    await page.evaluate(() => {
      map.setZoom(12);
      draw();
    });
    await page.waitForFunction(() => Math.abs(map.getZoom() - 12) < 0.01);

    const dragPts = await page.evaluate(() => {
      const c = legLabelCenter(0, 'in');
      const f = legFrame(0);
      const r = map.getContainer().getBoundingClientRect();
      const perp = (c.x - f.mx) * f.nx + (c.y - f.my) * f.ny;
      const targetAlong = f.len * 0.85;       // well beyond B's perpendicular gate
      const target = {
        x: f.mx + f.dx * targetAlong + f.nx * perp,
        y: f.my + f.dy * targetAlong + f.ny * perp,
      };
      return {
        start: { x: r.left + c.x, y: r.top + c.y },
        target: { x: r.left + target.x, y: r.top + target.y },
        targetAlong,
      };
    });

    await page.mouse.move(dragPts.start.x, dragPts.start.y);
    await page.mouse.down();
    await page.mouse.move(dragPts.target.x, dragPts.target.y, { steps: 8 });
    await page.mouse.up();

    const out = await page.evaluate(() => {
      const f = legFrame(0);
      const c = legLabelCenter(0, 'in');
      const sc = legZoomScale();
      const limit = f.len / (2 * sc);
      const alongPx = (c.x - f.mx) * f.dx + (c.y - f.my) * f.dy;
      return { label: state.legs[0].inLabel, limit, alongPx, halfPx: f.len / 2 };
    });
    expect(out.label._default).toBeUndefined();
    expect(out.label._m).toBe(1);
    expect(dragPts.targetAlong).toBeGreaterThan(out.halfPx + 20);
    expect(out.label.a).toBeCloseTo(out.limit, 1);
    expect(out.alongPx).toBeLessThanOrEqual(out.halfPx + 1);

    const symmetric = await page.evaluate(() => {
      const leg = state.legs[0];
      const limit = legFrame(0).len / (2 * legZoomScale());
      leg.inLabel.a = 99999;
      leg.outLabel = { a: -99999, p: -30, _m: 1 };
      clampLegLabelAlong(0, leg.inLabel);
      clampLegLabelAlong(0, leg.outLabel);
      return { limit, inA: leg.inLabel.a, outA: leg.outLabel.a };
    });
    expect(symmetric.inA).toBeCloseTo(symmetric.limit, 6);
    expect(symmetric.outA).toBeCloseTo(-symmetric.limit, 6);
  });
});

test.describe('Page-frame drag grip (C3)', () => {
  test('hitPageFrameEdge: border band true, centre false', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => {
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
