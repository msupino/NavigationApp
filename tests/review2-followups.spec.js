// Follow-ups from the second review of main.
const { test, expect } = require('./_setup');

const NOTAM_RE = /notam-data\/notam\.json/;
const FEED = { fir: 'LLLL', notams: [
  { id: 'UL1/26', icao: 'LLLL', type: 'AECH', text: 'ULTRALIGHT BUBBLE ZVULUN NORTH (BZVUE) AVBL.',
    start: '2020-01-01T00:00:00Z', end: '2035-01-01T00:00:00Z',
    geom: { type: 'circle', lat: 32.8, lng: 35.1, radiusNm: 4 } },
] };

async function bootNotam(page, feed) {
  await page.route(NOTAM_RE, r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(feed || FEED) }));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof activeNotams === 'function' && Array.isArray(window.notams));
}

test('the assistant reads the whole FIR, not just the chart on screen', async ({ page }) => {
  // A question about NOTAMs is not scoped to the chart the map happens to show:
  // on CVFR the per-chart filter hides the ultralight ones, and the assistant
  // would have answered "none".
  await bootNotam(page);
  const out = await page.evaluate(async () => {
    const sel = document.getElementById('layer-select');
    sel.value = 'CVFR'; sel.onchange();
    await new Promise(r => setTimeout(r, 250));
    return {
      onChart: activeNotams().map(n => n.id),
      wholeFeed: activeNotams({ allCharts: true }).map(n => n.id),
      assistantSees: (window.NavAid && NavAid.__assistantNotamIds)
        ? NavAid.__assistantNotamIds() : null,
    };
  });
  expect(out.onChart).toEqual([]);                 // hidden on CVFR, as designed
  expect(out.wholeFeed).toEqual(['UL1/26']);       // still reachable
  // The assistant's own accessor must use the unfiltered list.
  const src = await (await fetch('http://localhost:8000/app/assistant.js')).text();
  expect(src).toMatch(/activeNotams\(\{\s*allCharts:\s*true\s*\}\)/);
});

test('the NOTAM list button hides when this chart has nothing to list', async ({ page }) => {
  await bootNotam(page);
  const out = await page.evaluate(async () => {
    const btn = document.getElementById('notam-list-btn');
    const go = async n => {
      const sel = document.getElementById('layer-select');
      sel.value = n; sel.onchange();
      await new Promise(r => setTimeout(r, 300));
      if (typeof refreshNotamListBtn === 'function') refreshNotamListBtn();
      return { shown: activeNotams().length, hidden: btn.hidden, cbDisabled: document.getElementById('notam-cb').disabled };
    };
    return { cvfr: await go('CVFR'), lsa: await go('Low Alt') };
  });
  expect(out.cvfr.shown).toBe(0);
  expect(out.cvfr.hidden).toBe(true);        // nothing to open
  expect(out.lsa.shown).toBe(1);
  expect(out.lsa.hidden).toBe(false);        // the ultralight NOTAM lives here
  // The toggle itself stays usable either way — it is gated on feed presence, so
  // the timeline slider can never disable and uncheck the overlay.
  expect(out.cvfr.cbDisabled).toBe(false);
  expect(out.lsa.cbDisabled).toBe(false);
});

test('a refused library write says so instead of looking like success', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof load === 'function');
  const out = await page.evaluate(async () => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
    state.legs = []; syncLegs(); draw();
    const lib = [{ id: 'r1', name: 'Round trip', savedAt: new Date().toISOString(), data: serializeRoute() }];
    // Make the write fail the way a full quota does.
    const realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'navaid.routes') { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      return realSet.call(this, k, v);
    };
    let alerted = null, toasted = null;
    const realAlert = window.alert, realToast = window.showToast;
    window.alert = m => { alerted = m; };
    window.showToast = m => { toasted = m; };
    try {
      load(new File([JSON.stringify(lib)], 'navaid-routes.json', { type: 'application/json' }));
      await new Promise(r => setTimeout(r, 300));
    } finally {
      Storage.prototype.setItem = realSet;
      window.alert = realAlert; window.showToast = realToast;
    }
    return { alerted, toasted };
  });
  expect(out.alerted).toBeTruthy();     // the failure is reported
  expect(out.toasted).toBeNull();       // and never reported as an import
});

test('entries the import refuses are counted in the message', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof load === 'function');
  const out = await page.evaluate(async () => {
    localStorage.removeItem('navaid.routes');
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
    state.legs = []; syncLegs(); draw();
    const good = serializeRoute();
    const lib = [
      { id: 'a', name: 'Good', savedAt: new Date().toISOString(), data: good },
      { id: 'b', name: 'Bad', savedAt: new Date().toISOString(), data: { waypoints: [], legs: [] } },
      { id: 'c', name: 'Junk', savedAt: new Date().toISOString() },
    ];
    let toasted = null;
    const realToast = window.showToast;
    window.showToast = m => { toasted = m; };
    try {
      load(new File([JSON.stringify(lib)], 'navaid-routes.json', { type: 'application/json' }));
      await new Promise(r => setTimeout(r, 300));
    } finally { window.showToast = realToast; }
    return { toasted, stored: JSON.parse(localStorage.getItem('navaid.routes') || '[]').length };
  });
  expect(out.stored).toBe(1);
  expect(out.toasted).toMatch(/1/);
  expect(out.toasted).toMatch(/2/);          // and says two were refused
  expect(out.toasted).toMatch(/skip/i);
});

test('the profile strokes runs as one path and dashes the assumed boundary', async ({ page }) => {
  // Segment-at-a-time stroking left butt ends at every TOC kink; a run must be one
  // path, and the segment bridging assumed -> known must not read as measured.
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof routeProfile === 'function');
  const out = await page.evaluate(() => {
    if (typeof loadAirfields === 'function') loadAirfields();
    state.waypoints = [
      { lat: 32.17944, lng: 34.83444, name: 'LLHZ' },
      { lat: 32.55, lng: 34.95, name: 'B' },
      { lat: 32.9, lng: 35.05, name: 'C' },
    ];
    state.legs = []; syncLegs();
    state.legs[0].flightSpeed = 100; state.legs[0].inboundAltitude = null;   // assumed
    state.legs[1].flightSpeed = 100; state.legs[1].inboundAltitude = 4500;   // known
    draw();
    // Record the canvas calls the profile makes.
    const calls = [];
    const c = document.createElement('canvas').getContext('2d');
    const realDash = c.setLineDash.bind(c), realBegin = c.beginPath.bind(c), realStroke = c.stroke.bind(c);
    let dash = [];
    c.setLineDash = d => { dash = d; calls.push({ op: 'dash', dashed: d.length > 0 }); realDash(d); };
    c.beginPath = () => { calls.push({ op: 'begin', dashed: dash.length > 0 }); realBegin(); };
    c.lineTo = (function (real) { return function (...a) { calls.push({ op: 'lineTo' }); return real.apply(c, a); }; })(c.lineTo.bind(c));
    // Capture lineJoin AT stroke time: the function restores canvas state when it
    // finishes, so reading it afterwards says nothing.
    c.stroke = () => { calls.push({ op: 'stroke', dashed: dash.length > 0, join: c.lineJoin }); realStroke(); };
    drawVerticalProfile(c, 0, 0, 300, 120);
    const prof = routeProfile();
    return { calls, assumed: prof.pts.map(p => !!p.assumed) };
  });
  expect(out.assumed.some(Boolean)).toBe(true);
  expect(out.assumed.some(a => !a)).toBe(true);

  // A multi-point run is one path: some stroke must follow more than one lineTo.
  const strokes = [];
  let segs = 0;
  for (const c of out.calls) {
    if (c.op === 'lineTo') segs++;
    if (c.op === 'stroke') { strokes.push(segs); segs = 0; }
  }
  expect(Math.max(...strokes)).toBeGreaterThan(1);
  // Multi-segment runs are joined, not butt-ended at every kink.
  const multi = out.calls.filter((c, i) => c.op === 'stroke');
  expect(multi.some(c => c.join === 'round')).toBe(true);
  // And at least one dashed stroke exists (the assumed run + its boundary).
  expect(out.calls.some(c => c.op === 'stroke' && c.dashed)).toBe(true);
});
