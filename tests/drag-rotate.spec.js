// @ts-check
// Coverage for the canvas-overlay drag + rotate maths that the pointer
// handlers sit on top of:
//  C2 — legLabelCenter()/hitLegLabel()/legFrame(): the kite-label hit test
//       returns {i,which} only when the cursor is on the rendered label.
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
