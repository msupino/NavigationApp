// @ts-check
// Regressions from the interact / editor / deck audit:
//   - a right-click (or right-drag) on a waypoint is the context menu's, not a press;
//   - a loop's shared point is several visits, and a drag of it treats them all alike on
//     cancel (touch) and on a drop onto a route neighbour (the delete gesture);
//   - the cumulative kite on an out-and-back leg does not jump sideways when dragged;
//   - a phone long-press on a waypoint is a grab, so the chart's Point details stays shut;
//   - the hidden editor: a double-click closes a ring without doubling its last corner, and
//     Download does not throw.
const { test, expect } = require('./_setup');

async function boot(page, q) {
  await page.goto('?lang=en&nogist' + (q || ''));
  await page.waitForFunction(() => typeof draw === 'function' && typeof syncLegs === 'function' &&
    typeof map !== 'undefined' && typeof setMode === 'function');
  await page.evaluate(() => {
    const b = document.getElementById('boot-loading');
    if (b) b.remove();
    document.documentElement.classList.remove('app-booting');
  });
}

// A-B-C-A: the first and last waypoints are one place visited twice.
const loopRoute = (page) => page.evaluate(() => {
  state.waypoints = [
    { lat: 32.1, lng: 34.8, name: 'ALPHA' },
    { lat: 32.0, lng: 34.9, name: 'BRAVO' },
    { lat: 32.15, lng: 34.98, name: 'CHARLIE' },
    { lat: 32.1, lng: 34.8, name: 'ALPHA' },
  ];
  syncLegs();
  map.setView([32.08, 34.89], 11, { animate: false });
  draw();
});

// Page coordinates of waypoint i.
const at = (page, i) => page.evaluate((idx) => {
  const p = map.latLngToContainerPoint([state.waypoints[idx].lat, state.waypoints[idx].lng]);
  const b = map.getContainer().getBoundingClientRect();
  return { x: b.left + p.x, y: b.top + p.y };
}, i);

const zeroLegs = (page) => page.evaluate(() => {
  let n = 0;
  for (let i = 0; i + 1 < state.waypoints.length; i++) {
    if (sameMapPoint(state.waypoints[i], state.waypoints[i + 1])) n++;
  }
  return n;
});

test.describe('mouse', () => {
  test('a right-click on a waypoint in Add mode adds nothing and a right-drag moves nothing', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.1, lng: 34.8, name: 'ALPHA' },
        { lat: 32.0, lng: 34.9, name: 'BRAVO' },
        { lat: 32.15, lng: 34.98, name: 'CHARLIE' },
      ];
      syncLegs();
      map.setView([32.08, 34.89], 11, { animate: false });
      draw();
      setMode('add');
    });
    const p = await at(page, 0);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    expect(await page.evaluate(() => state.waypoints.length)).toBe(3);
    await page.keyboard.press('Escape');

    const before = await page.evaluate(() => ({ lat: state.waypoints[0].lat, lng: state.waypoints[0].lng }));
    await page.mouse.move(p.x, p.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(p.x + 60, p.y + 40, { steps: 5 });
    await page.mouse.up({ button: 'right' });
    expect(await page.evaluate(() => ({ lat: state.waypoints[0].lat, lng: state.waypoints[0].lng }))).toEqual(before);
    expect(await page.evaluate(() => state.waypoints.length)).toBe(3);
  });

  // Whichever visit the press picks up, dropping the loop's shared point onto a neighbour of
  // EITHER visit deletes that visit -- never leaves a zero-length leg behind.
  for (const target of [1, 2]) {
    test('dropping a loop\'s shared point on waypoint ' + target + ' leaves no zero-length leg', async ({ page }) => {
      await boot(page);
      await loopRoute(page);
      const out = await page.evaluate((t) => {
        const a = state.waypoints[0];
        const pa = map.latLngToContainerPoint([a.lat, a.lng]);
        map.fire('mousedown', { containerPoint: pa, latlng: L.latLng(a.lat, a.lng),
          originalEvent: new MouseEvent('mousedown', { button: 0 }) });
        const grabbed = drag && [drag.i].concat(drag.also || []);
        const dst = state.waypoints[t];
        const ll = L.latLng(dst.lat, dst.lng);
        const pd = map.latLngToContainerPoint(ll);
        map.fire('mousemove', { containerPoint: L.point((pa.x + pd.x) / 2, (pa.y + pd.y) / 2),
          latlng: map.containerPointToLatLng([(pa.x + pd.x) / 2, (pa.y + pd.y) / 2]) });
        map.fire('mousemove', { containerPoint: pd, latlng: ll });
        window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return { grabbed: grabbed && grabbed.length, n: state.waypoints.length };
      }, target);
      expect(out.grabbed).toBe(2);                 // both visits travel together
      expect(out.n).toBe(3);                       // one visit gone
      expect(await zeroLegs(page)).toBe(0);
      expect(await page.evaluate(() => state.legs.length)).toBe(2);
    });
  }

  test('the cumulative kite on an out-and-back leg stays where it is held', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      state.waypoints = [
        { lat: 32.0, lng: 34.8, name: 'ALPHA' },
        { lat: 32.1, lng: 34.95, name: 'BRAVO' },
        { lat: 32.0, lng: 34.8, name: 'ALPHA' },
      ];
      syncLegs();
      map.setView([32.05, 34.88], 11, { animate: false });
      draw();
      const off = legPairOffsetPx(0);
      const c = cumLabelCenter(0);
      // Put the kite back exactly where it already is: it must not move.
      _materialiseDefaultCumLabel(0);
      setCumLabelFromPoint(0, false, c.x, c.y);
      const c2 = cumLabelCenter(0);
      const cr = cumLabelRetCenter(0);
      _materialiseDefaultCumLabelRet(0);
      setCumLabelFromPoint(0, true, cr.x, cr.y);
      const cr2 = cumLabelRetCenter(0);
      return { off, jump: Math.hypot(c2.x - c.x, c2.y - c.y), jumpRet: Math.hypot(cr2.x - cr.x, cr2.y - cr.y) };
    });
    expect(r.off).toBeGreaterThan(0);              // the pair IS drawn offset
    expect(r.jump).toBeLessThan(0.5);
    expect(r.jumpRet).toBeLessThan(0.5);
  });
});

test.describe('touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  const touch = (page, type, x, y) => page.evaluate(([t, px, py]) => {
    const el = map.getContainer();
    const init = { clientX: px, clientY: py, pageX: px, pageY: py, identifier: 1, target: el };
    const list = t === 'touchend' ? [] : [new Touch(init)];
    el.dispatchEvent(new TouchEvent(t, {
      bubbles: true, cancelable: true, touches: list, targetTouches: list,
      changedTouches: [new Touch(init)],
    }));
  }, [type, x, y]);

  test('a cancelled touch drag of a loop\'s shared point puts BOTH visits back', async ({ page }) => {
    await boot(page);
    await loopRoute(page);
    // Close in, so a couple of pixels off the start is still "put back where it was"
    // (sameMapPoint) and yet a different coordinate.
    await page.evaluate(() => { map.setView([32.1, 34.8], 15, { animate: false }); draw(); });
    const p = await at(page, 0);
    // Past the touch slop but short of the origin re-snap distance: picked up, put back.
    await touch(page, 'touchstart', p.x, p.y);
    await touch(page, 'touchmove', p.x + 13, p.y);
    await touch(page, 'touchmove', p.x + 2, p.y);
    await touch(page, 'touchend', p.x + 2, p.y);
    const got = await page.evaluate(() => state.waypoints.map(w => [w.lat, w.lng, w.name]));
    expect(got.length).toBe(4);
    expect(got[0]).toEqual([32.1, 34.8, 'ALPHA']);
    expect(got[3]).toEqual([32.1, 34.8, 'ALPHA']);
  });

  test('a long press on a waypoint is a grab: Point details does not open', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await boot(page);
    await page.waitForFunction(() => window.NavAid && typeof NavAid.refreshMobileDeck === 'function');
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.08, lng: 34.89, name: 'ALPHA' }, { lat: 32.3, lng: 35.1, name: 'BRAVO' }];
      syncLegs();
      map.setView([32.08, 34.89], 11, { animate: false });
      draw();
    });
    const p = await at(page, 0);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
    await page.waitForTimeout(700);
    const during = await page.evaluate(() => ({
      sel: state.selected && state.selected.type,
      sheet: !document.getElementById('deck-sheet') || document.getElementById('deck-sheet').hidden,
    }));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(during.sel).not.toBe('coord');
    expect(during.sheet).toBe(true);
    // The press is still a hold, not a tap: nothing is left open behind it.
    expect(await page.evaluate(() => document.getElementById('inspector').classList.contains('hidden'))).toBe(true);
  });
});

test.describe('editor', () => {
  test('a double-click closes the ring without doubling its last corner', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
    await page.goto('?lang=en&editor=1');
    await page.waitForSelector('#editor-panel');
    await page.waitForFunction(() => typeof map !== 'undefined');
    const coords = await page.evaluate(() => {
      map.setView([32.0, 34.9], 11);
      document.querySelector('input[name=ed-m][value=polygon]').click();
      map.fire('click', { latlng: L.latLng(32.0, 34.8) });
      map.fire('click', { latlng: L.latLng(32.1, 34.8) });
      map.fire('click', { latlng: L.latLng(32.1, 34.9) });
      // The browser's double-click: click, click, dblclick, all on the last corner.
      const last = L.latLng(32.05, 34.95);
      map.fire('click', { latlng: last });
      map.fire('click', { latlng: last });
      map.fire('dblclick', { latlng: last, originalEvent: new MouseEvent('dblclick') });
      return JSON.parse(document.getElementById('ed-json').value)[0].coords;
    });
    expect(coords.length).toBe(4);
  });

  test('Download saves without throwing', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
    await page.goto('?lang=en&editor=1');
    await page.waitForSelector('#editor-panel');
    await page.evaluate(() => { window.saveFile = () => Promise.resolve(true); });
    await page.locator('#ed-dl').click();
    await page.waitForTimeout(100);
    expect(errors).toEqual([]);
  });
});
