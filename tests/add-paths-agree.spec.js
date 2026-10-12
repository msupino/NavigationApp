// @ts-check
// Every way of adding a point to the end of the route makes the same route. Reported: "add wp
// with right click doesn't add freq changes" -- the inspector's Add to route (which the right-
// click menu presses) and the long-press sheet added the point and nothing else, so LLHZ BAZRA
// DEROR built that way had no frequency change at DEROR, where the same taps in Add mode had
// one; and a held spot's Add to route did not snap to the point under it, so it came out
// unnamed. All of them go through addRoutePoint now. The pilot's own test: LLHZ BAZRA DEROR SHARO.
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 1300, height: 850 } });
test.setTimeout(60000);

test('Add mode, search, inspector, right-click, a held spot and the long-press sheet build the same route', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.NavAidContextMenu && NavAid.deckAddHere && typeof findNavWpToken === 'function'
    && Array.isArray(window.airfields) && typeof setMode === 'function');
  const out = await page.evaluate(async () => {
    if (navWP === null) await loadNavWaypoints();
    window.appConfirm = async () => true; window.askYesNo = async () => true;
    const pts = ['LLHZ', 'BAZRA', 'DEROR', 'SHARO'].map(n => findNavWpToken(n) || airfields.find(a => a.name === n));
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const reset = () => { state.waypoints = []; state.legs = []; state.notes = []; state.commChangeSuppressions = []; state.selected = null; syncLegs(); draw(); };
    const snap = () => ({ wps: state.waypoints.map(w => w.name || '?'),
      cc: state.notes.filter(n => n.cc).map(n => n.cc + '=' + (n.freqName || '') + ' ' + (n.freq || '')).sort() });
    const c = map.getContainer().getBoundingClientRect();
    map.setView([32.2, 34.9], 11, { animate: false }); draw();
    const near = (p) => { const cp = map.latLngToContainerPoint(p); return map.containerPointToLatLng([cp.x + 6, cp.y + 6]); };
    const res = {};
    reset(); setMode('add');
    for (const p of pts) {
      const cp = map.latLngToContainerPoint(p);
      map.fire('click', { latlng: L.latLng(p.lat, p.lng), containerPoint: cp, layerPoint: map.containerPointToLayerPoint(cp), originalEvent: new MouseEvent('click') });
      await wait(300);
    }
    setMode(null); await wait(800); res.addMode = snap();
    reset();
    const inp = document.getElementById('wp-search'); inp.value = 'LLHZ BAZRA DEROR SHARO';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(1500); res.search = snap();
    reset();
    for (const p of pts) {
      const af = airfields.indexOf(p);
      state.selected = af >= 0 ? { type: 'airfield', index: af } : { type: 'navwp', index: navWP.indexOf(p) };
      showInspector(); document.getElementById('insp-add-to-route').click(); await wait(300);
    }
    await wait(800); res.inspector = snap();
    reset();
    for (const p of pts) {
      const cp = map.latLngToContainerPoint(p);
      map.getContainer().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: c.left + cp.x, clientY: c.top + cp.y }));
      [...document.querySelectorAll('.ctx-menu .ctx-item')].find(x => /Add to route|Start route here/.test(x.textContent)).click();
      await wait(300);
    }
    await wait(800); res.rightClick = snap();
    reset();
    for (const p of pts) {
      const ll = near(p); state.selected = { type: 'coord', lat: ll.lat, lng: ll.lng, held: true };
      showInspector(); document.getElementById('insp-add-to-route').click(); await wait(300);
    }
    await wait(800); res.heldSpot = snap();
    reset();
    for (const p of pts) { NavAid.deckAddHere(near(p)); await wait(300); }
    await wait(800); res.longPress = snap();
    return res;
  });
  expect(out.addMode).toEqual({ wps: ['LLHZ', 'BAZRA', 'DEROR', 'SHARO'], cc: ['DEROR=PLUTO_WEST 118.40'] });
  for (const k of ['search', 'inspector', 'rightClick', 'heldSpot', 'longPress']) expect(out[k], k).toEqual(out.addMode);
});

test('Direct to a frequency-change point seeds its change, like any other new route', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => NavAid.deckDirectTo && typeof findNavWpToken === 'function');
  const cc = await page.evaluate(async () => {
    if (navWP === null) await loadNavWaypoints();
    window.gpsOwn = { lat: 32.18, lng: 34.83 };
    state.waypoints = []; state.legs = []; state.notes = []; syncLegs();
    await NavAid.deckDirectTo(findNavWpToken('DEROR'));
    return state.notes.filter(n => n.cc).map(n => n.cc);
  });
  expect(cc).toContain('DEROR');
});
