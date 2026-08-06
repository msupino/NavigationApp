// @ts-check
// The published-coverage ring is drawn for the selected station, else the inspector's
// VOR-row override, else the global reference — in that order. Removing the global
// reference therefore did NOT clear the ring while an override was set: it kept ringing the
// old station until the inspector was closed, which is when the override is reset.
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
    typeof loadVors === 'function' && typeof resetInspectorVorRef === 'function' &&
    !!document.getElementById('vor-ref-select'));
  await page.evaluate(() => loadVors());
}

// The ident the ring resolves to — the same precedence drawVors() applies.
const RING = `(() => {
  const selectedStation = (state.selected && state.selected.type === 'vor' &&
    vors[state.selected.index]) ? vors[state.selected.index].ident : null;
  const ident = selectedStation ||
    (typeof inspectorVorRef === 'string' && inspectorVorRef) || vorRef;
  const v = ident ? vors.find(x => x.ident === ident) : null;
  return { ident: ident || null, rings: !!(v && v.coverageNm > 0) };
})()`;

test('removing the reference clears the ring, even with an inspector override set', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(`(() => {
    const sel = document.getElementById('vor-ref-select');
    const set = v => { sel.value = v; sel.dispatchEvent(new Event('change')); };
    set('NAT');
    const withRef = ${RING};
    // What touching the inspector's VOR row does: it pins the override, whose default is
    // the global ident, so this is the ordinary case rather than a contrived one.
    window.inspectorVorRef = 'NAT';
    const withOverride = ${RING};
    set('');                                  // the pilot removes the reference
    return { withRef, withOverride, afterRemove: ${RING},
      vorRef: vorRef, override: inspectorVorRef };
  })()`);
  expect(r.withRef).toEqual({ ident: 'NAT', rings: true });
  expect(r.withOverride).toEqual({ ident: 'NAT', rings: true });
  // Was: ident 'NAT', rings true — the ring outlived the reference it came from and only
  // went when the inspector closed.
  expect(r.afterRemove).toEqual({ ident: null, rings: false });
  expect(r.vorRef).toBeNull();
  expect(r.override).toBeUndefined();       // the override did not outlive the reference
});

test('switching the reference to another station rings that one, not the old override', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(`(() => {
    const sel = document.getElementById('vor-ref-select');
    const set = v => { sel.value = v; sel.dispatchEvent(new Event('change')); };
    set('NAT');
    window.inspectorVorRef = 'NAT';
    set('BGN');
    return ${RING};
  })()`);
  expect(r.ident).toBe('BGN');
  expect(r.rings).toBe(true);
});

test('the inspector VOR selector repaints the map', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 34.85, name: 'A' }, { lat: 32.4, lng: 35.05, name: 'B' }];
    syncLegs();
    state.selected = { type: 'wp', index: 0 };
    showInspector();
    const sel = document.querySelector('#insp-body select.insp-vor-select') ||
      Array.from(document.querySelectorAll('#insp-body select'))
        .find(s => Array.from(s.options).some(o => o.value === 'NAT'));
    if (!sel) return { noSelector: true };
    let draws = 0;
    const real = window.draw;
    window.draw = function (...a) { draws++; return real.apply(this, a); };
    sel.value = 'NAT';
    sel.dispatchEvent(new Event('change'));
    const afterPick = { draws, override: inspectorVorRef };
    window.draw = real;
    return { afterPick };
  });
  if (r.noSelector) test.skip(true, 'no VOR row in this inspector build');
  expect(r.afterPick.override).toBe('NAT');
  // The ring is canvas ink: without a repaint it kept showing the previous station until
  // some unrelated redraw happened to run.
  expect(r.afterPick.draws).toBeGreaterThan(0);
});
