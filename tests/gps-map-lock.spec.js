// @ts-check
// Moving a waypoint out from under an in-progress leg mid-flight is exactly the edge
// case that can spuriously fire/miss the leg-approach and TOP watch alerts (see
// gpsCheckLegAlerts's own _gpsAlertMinDistNm comment in gps.js). While any own-ship
// position source is live -- real GPS (recording or just showing location) or a
// connected simulator -- gpsMapLocked() freezes waypoint dragging. A plain click/tap
// still opens the inspector as normal: wanting to see a waypoint's satellite image
// mid-flight is unaffected, only the position edit is skipped.
const { test, expect } = require('./_setup');
const { LLHZ } = require('./_airfieldArp');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof map !== 'undefined' && typeof endMouseDrag === 'function' &&
    typeof gpsMapLocked === 'function');
  await page.evaluate((wp) => {
    state.waypoints = [{ lat: wp.lat, lng: wp.lng, name: 'A' }];
    syncLegs();
    map.setView([wp.lat, wp.lng], 11);
    draw();
  }, LLHZ);
}

// Fires the same mousedown -> mousemove -> mouseup sequence the real drag path uses,
// via Leaflet's own event bus (map.fire), same technique first-click-arming.spec.js
// uses for map clicks -- reliable across zoom/projection without needing real DOM
// pixel math beyond the one latLngToContainerPoint conversion.
async function simulateDrag(page, dxPx) {
  return page.evaluate((dx) => {
    const wp = state.waypoints[0];
    const p0 = map.latLngToContainerPoint([wp.lat, wp.lng]);
    map.fire('mousedown', { containerPoint: p0, latlng: L.latLng(wp.lat, wp.lng) });
    const p1 = L.point(p0.x + dx, p0.y);
    const ll1 = map.containerPointToLatLng(p1);
    map.fire('mousemove', { containerPoint: p1, latlng: ll1 });
    endMouseDrag();
    return {
      lat: state.waypoints[0].lat, lng: state.waypoints[0].lng,
      inspectorOpen: !document.getElementById('inspector').classList.contains('hidden'),
      selected: state.selected,
    };
  }, dxPx);
}

// Reported: the waypoint was locked, but its nav kite and the cumulative-time kite still
// dragged, as did notes and comm callouts. Same hazard with a smaller target -- all of it is
// route layout being rewritten mid-flight, under the alerts measuring against it.
test.describe('every draggable piece of the route is locked, not just the waypoint', () => {
  const KINDS = ['label', 'cumlabel', 'cumlabelret', 'note'];

  for (const kind of KINDS) {
    test(kind + ' does not move while tracking, and moves again once it stops', async ({ page }) => {
      await boot(page);
      const out = await page.evaluate((k) => {
        // A two-waypoint route so the kites have a leg to belong to.
        state.waypoints = [
          { lat: 32.00, lng: 34.00, name: 'A' },
          { lat: 32.10, lng: 34.10, name: 'B' },
        ];
        state.notes = [{ lat: 32.05, lng: 34.05, text: 'note', color: '#ffd166', shape: 'rect' }];
        syncLegs();
        draw();
        const snapshot = () => JSON.stringify({
          inLabel: state.legs[0].inLabel, cum: state.legs[0].cumLabel,
          cumRet: state.legs[0].cumLabelRet,
          note: { lat: state.notes[0].lat, lng: state.notes[0].lng },
        });
        const move = () => {
          const p0 = map.latLngToContainerPoint([32.05, 34.05]);
          drag = { kind: k, i: 0, which: 'in', moved: false,
                   offLat: 0, offLng: 0, lx: p0.x, ly: p0.y };
          map.fire('mousemove', {
            containerPoint: L.point(p0.x + 70, p0.y + 50),
            latlng: map.containerPointToLatLng(L.point(p0.x + 70, p0.y + 50)),
          });
          const after = snapshot();
          drag = null;
          return after;
        };
        const before = snapshot();
        window.gpsLiveOn = true;                       // showing location
        const whileTracking = move();
        window.gpsLiveOn = false;
        const afterStopping = move();
        return { before, whileTracking, afterStopping };
      }, kind);
      expect(out.whileTracking).toBe(out.before);          // frozen in flight
      expect(out.afterStopping).not.toBe(out.before);      // ...and free on the ground
    });
  }

  test('a simulator connection locks them too', async ({ page }) => {
    await boot(page);
    const locked = await page.evaluate(() => {
      window.simOn = true;
      const kinds = ['wp', 'label', 'cumlabel', 'cumlabelret', 'note'];
      const out = kinds.map(k => dragLockedNow(k));
      window.simOn = false;
      return { out, page: dragLockedNow('page') };
    });
    expect(locked.out).toEqual([true, true, true, true, true]);
    // The page frame is print layout, not the route: still free to position mid-flight.
    expect(locked.page).toBe(false);
  });
});

test.describe('map lock while GPS/sim connected', () => {
  test('live location on: dragging a waypoint neither moves it nor opens the inspector', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { window.gpsLiveOn = true; });
    const before = { lat: LLHZ.lat, lng: LLHZ.lng };
    const out = await simulateDrag(page, 80);   // a real drag distance, not a sub-pixel jiggle
    expect(out.lat).toBe(before.lat);
    expect(out.lng).toBe(before.lng);
    // The panel used to open here. In flight the map is what is being read, and the
    // inspector covers it -- see inspector-while-tracking.spec.js.
    expect(out.inspectorOpen).toBe(false);
    expect(out.selected).toBeNull();
  });

  test('recording on: same lock', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { window.gpsRecording = true; });
    const out = await simulateDrag(page, 80);
    expect(out.lat).toBe(LLHZ.lat);
    expect(out.lng).toBe(LLHZ.lng);
    expect(out.inspectorOpen).toBe(false);
  });

  // The simulator locks the DRAG (a route edit mid-flight can shift the alerts) but still
  // opens the inspector: a sim session is someone at a desk, where looking at a waypoint is
  // the point. Only a real fix closes the panel.
  test('connected simulator: the drag is locked, the inspector still opens', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { window.simOn = true; });
    const out = await simulateDrag(page, 80);
    expect(out.lat).toBe(LLHZ.lat);
    expect(out.lng).toBe(LLHZ.lng);
    expect(out.inspectorOpen).toBe(true);
  });

  test('none of the three on: dragging still moves the waypoint as normal', async ({ page }) => {
    await boot(page);
    const out = await simulateDrag(page, 80);
    expect(out.lat).not.toBe(LLHZ.lat);
    expect(out.lng).not.toBe(LLHZ.lng);
  });

  test('gpsMapLocked() reflects all three sources and clears when they stop', async ({ page }) => {
    await boot(page);
    const seq = await page.evaluate(() => {
      const out = [];
      out.push(gpsMapLocked());
      window.gpsLiveOn = true; out.push(gpsMapLocked());
      window.gpsLiveOn = false; out.push(gpsMapLocked());
      window.gpsRecording = true; out.push(gpsMapLocked());
      window.gpsRecording = false; out.push(gpsMapLocked());
      window.simOn = true; out.push(gpsMapLocked());
      window.simOn = false; out.push(gpsMapLocked());
      return out;
    });
    expect(seq).toEqual([false, true, false, true, false, true, false]);
  });
});

test.describe('legend hidden on mobile while a position source is live', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('legend visible normally, hidden once live, visible again once stopped', async ({ page }) => {
    await boot(page);
    const before = await page.evaluate(() =>
      getComputedStyle(document.getElementById('map-legend')).display);
    expect(before).not.toBe('none');
    const live = await page.evaluate(() => {
      window.gpsLiveOn = true;
      draw();   // gpsMapLocked() is synced at the top of draw(), not on the flag write itself
      return getComputedStyle(document.getElementById('map-legend')).display;
    });
    expect(live).toBe('none');
    const after = await page.evaluate(() => {
      window.gpsLiveOn = false;
      draw();
      return getComputedStyle(document.getElementById('map-legend')).display;
    });
    expect(after).not.toBe('none');
  });

  test('recording and a connected simulator hide it too', async ({ page }) => {
    await boot(page);
    for (const flag of ['gpsRecording', 'simOn']) {
      const hidden = await page.evaluate((f) => {
        window[f] = true;
        draw();
        const d = getComputedStyle(document.getElementById('map-legend')).display;
        window[f] = false;
        draw();
        return d;
      }, flag);
      expect(hidden, flag).toBe('none');
    }
  });
});
