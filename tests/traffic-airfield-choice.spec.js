// @ts-check
// A plane sitting over an airfield must offer the multi-item chooser, not silently select the
// plane. traffic.js gathers the overlay candidates at the tapped point and hands the chooser a
// {type:'traffic'} candidate alongside them; the chooser can list and select it.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof loadAirfields === 'function' && typeof showPointChoice === 'function' && typeof selectPointCandidate === 'function');
  await page.evaluate(async () => { await loadAirfields();
    window.trafficAircraft = [{ hex: 'ABC123', flight: 'TEST01', lat: 32.18, lon: 34.83 },
                              { hex: 'Z9', flight: '', lat: 32.0, lon: 34.8 }]; });
}

test('the chooser lists the aircraft and the airfield, and both are selectable', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const i = airfields.findIndex(a => a.name === 'LLHZ');
    const cand = [{ type: 'traffic', hex: 'ABC123', aircraft: { hex: 'ABC123', flight: 'TEST01' } },
                  { type: 'airfield', index: i, chartPoint: true }];
    const ok = showPointChoice(cand);
    const opts = [...document.querySelectorAll('.point-choice-option .point-choice-primary')].map(e => e.textContent);
    return { ok, opts };
  });
  expect(r.ok).toBe(true);
  expect(r.opts).toContain('TEST01');                 // the aircraft, by flight id
  expect(r.opts.some(o => /Herzliya|LLHZ/i.test(o || ''))).toBe(true);
});

test('choosing the aircraft selects traffic; choosing the field selects the airfield', async ({ page }) => {
  await boot(page);
  const sel = await page.evaluate(() => {
    const i = airfields.findIndex(a => a.name === 'LLHZ');
    // pick the aircraft
    showPointChoice([{ type: 'traffic', hex: 'ABC123', aircraft: { hex: 'ABC123', flight: 'TEST01' } },
                     { type: 'airfield', index: i }]);
    [...document.querySelectorAll('.point-choice-option')].find(b => /TEST01/.test(b.textContent)).click();
    const afterPlane = state.selected && state.selected.type;
    // pick the airfield
    showPointChoice([{ type: 'traffic', hex: 'ABC123', aircraft: { hex: 'ABC123', flight: 'TEST01' } },
                     { type: 'airfield', index: i }]);
    [...document.querySelectorAll('.point-choice-option')].find(b => !/TEST01/.test(b.textContent)).click();
    const afterField = state.selected && state.selected.type;
    return { afterPlane, afterField };
  });
  expect(sel.afterPlane).toBe('traffic');
  expect(sel.afterField).toBe('airfield');
});

test('a single aircraft candidate selects it directly (no modal)', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const ok = showPointChoice([{ type: 'traffic', hex: 'Z9', aircraft: { hex: 'Z9' } }]);
    return { ok, sel: state.selected && state.selected.type, modal: !!document.querySelector('.point-choice-modal') };
  });
  expect(r.ok).toBe(true);
  expect(r.sel).toBe('traffic');
  expect(r.modal).toBe(false);
});

// Regression: while a position drives the map (in flight) with "Panel while showing position"
// off, tapping a plane sitting over a point used to do nothing — the chooser was refused by the
// in-flight gate because it checked the OLD selection, not the plane just tapped. A traffic
// candidate must now get it through, while a non-traffic overlap stays gated.
test('while showing position, a plane over a point still opens the chooser', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    gpsLiveOn = true;                                             // a fix is driving the map
    try { localStorage.setItem('navaid.inspectorWhileTracking', '0'); } catch (e) {}  // panel OFF
    const i = airfields.findIndex(a => a.name === 'LLHZ');
    const ok = showPointChoice([{ type: 'traffic', hex: 'ABC123', aircraft: { hex: 'ABC123', flight: 'TEST01' } },
                                { type: 'airfield', index: i }]);
    const modal = !!document.querySelector('.point-choice-modal');
    gpsLiveOn = false;
    return { ok, modal };
  });
  expect(r.ok).toBe(true);        // not refused by the in-flight gate anymore
  expect(r.modal).toBe(true);     // the chooser is on screen
});

test('while showing position, an overlap with no aircraft is still refused', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    gpsLiveOn = true;
    try { localStorage.setItem('navaid.inspectorWhileTracking', '0'); } catch (e) {}
    const idx = airfields.map((a, i) => i).filter(i => airfields[i] && airfields[i].name).slice(0, 2);
    const ok = showPointChoice([{ type: 'airfield', index: idx[0] }, { type: 'airfield', index: idx[1] }]);
    const modal = !!document.querySelector('.point-choice-modal');
    gpsLiveOn = false;
    return { ok, modal };
  });
  expect(r.ok).toBe(false);       // the gate still keeps ordinary taps off the chart in flight
  expect(r.modal).toBe(false);
});

// A plane over one of the pilot's own route waypoints must offer it too. Reported: a plane
// sitting on waypoint 3 did nothing (location was off, so the in-flight gate was not involved) --
// the traffic tap gathered only chart overlays, which exclude route waypoints. It now adds them.
test('the chooser offers a route waypoint under the plane, and it is selectable', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.10, lng: 34.85, name: 'ALPHA' }, { lat: 32.20, lng: 34.95, name: 'BRAVO' }];
    if (typeof syncLegs === 'function') syncLegs();
    draw();
    const s = proj(state.waypoints[1]);
    // The gather source the traffic handler now also uses finds the waypoint at its own pixel.
    const wpHits = (typeof hitWaypointCandidates === 'function') ? hitWaypointCandidates(s.x, s.y) : [];
    const ok = showPointChoice([{ type: 'traffic', hex: 'ABC123', aircraft: { hex: 'ABC123', flight: 'TEST01' } },
                                { type: 'wp', index: 1 }]);
    const opts = [...document.querySelectorAll('.point-choice-option .point-choice-primary')].map(e => e.textContent);
    // choose the waypoint
    [...document.querySelectorAll('.point-choice-option')].find(b => !/TEST01/.test(b.textContent)).click();
    return { wpFound: wpHits.some(h => h.type === 'wp' && h.index === 1), ok, opts,
      sel: state.selected && state.selected.type };
  });
  expect(r.wpFound).toBe(true);                               // the handler's new gather source sees it
  expect(r.ok).toBe(true);
  expect(r.opts).toContain('TEST01');                        // the aircraft
  expect(r.opts.some(o => /BRAVO/.test(o || ''))).toBe(true); // the waypoint, by name
  expect(r.sel).toBe('wp');                                   // choosing it selects the waypoint
});
