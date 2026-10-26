// @ts-check
// Regression tests for the draw.js audit findings: the page-fit ink box of a leg kite, the
// LSA activity sites on the CVFR chart, terrain under a recorded-track profile, the freq
// callout's route-hint ranking, the ?graphlegs=1 cache across layers, the NOTAM badge tap
// target and the exported measure label.
const { test, expect } = require('./_setup');

async function boot(page, extra = '') {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('?lang=en&nogist&deck=0' + extra);
  await page.waitForFunction(() => typeof routeInkRects === 'function' &&
    typeof legLabelCenter === 'function' && typeof map !== 'undefined');
}

test('page-fit ink box covers the leg kite as drawn (draw scale, along the leg)', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    // A diagonal leg, so a box tilted off the leg's axis has a visibly different footprint.
    state.waypoints = [{ lat: 32.10, lng: 34.80, name: 'A' }, { lat: 32.30, lng: 35.05, name: 'B' }];
    state.legs = []; syncLegs();
    state.legs.forEach(l => { l.flightSpeed = 110; l.inboundAltitude = 2000; });
    window.showCumTime = false; window.showReturn = false;
    map.setView([32.2, 34.92], 11, { animate: false });
    draw();
    const c = legLabelCenter(0, 'in');
    const a = proj(state.waypoints[0]), b = proj(state.waypoints[1]);
    let dx = b.x - a.x, dy = b.y - a.y; const len = Math.hypot(dx, dy); dx /= len; dy /= len;
    const sc = kiteDrawScale();
    const halfL = (tune('legKiteCellWidthPx') * 2 + tune('legKiteTriangleLenPx')) * sc / 2;
    const halfW = tune('legKiteHeightPx') * sc / 2;
    const xs = [], ys = [];
    for (const sl of [-1, 1]) for (const sw of [-1, 1]) {
      xs.push(c.x + dx * halfL * sl - dy * halfW * sw);
      ys.push(c.y + dy * halfL * sl + dx * halfW * sw);
    }
    const want = { x: Math.min(...xs), y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    // routeInkRects: the two waypoint discs first, then the leg kite.
    const got = routeInkRects()[2];
    return { want, got, ratio: sc / legZoomScale() };
  });
  expect(r.ratio).toBeGreaterThan(1.5);   // the case the finding is about: the two scales differ
  for (const k of ['x', 'y', 'w', 'h']) expect(Math.abs(r.got[k] - r.want[k])).toBeLessThan(1);
});

test('the CVFR chart drops the LSA layer\'s activity sites', async ({ page }) => {
  await boot(page);
  const n = await page.evaluate(async () => {
    // The app's own script globals, set the way the other specs set them.
    new Function("navDataPrefix = 'cvfr'; activitySites = [{ lat: 32.1, lng: 34.9, kind: 'parachute' }]; areas = null;")();
    await loadAreas();
    return activitySites.length;
  });
  expect(n).toBe(0);
});

test('recorded-track terrain is sampled at the distance it is plotted at', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    // 60 fixes parked at the start, then 20 fixes evenly along a straight 0.2-degree line.
    const pts = [];
    for (let i = 0; i < 60; i++) pts.push({ lat: 32.0, lng: 34.8, t: i * 1000, alt: 50 });
    for (let i = 1; i <= 20; i++) pts.push({ lat: 32.0 + 0.01 * i, lng: 34.8, t: 60000 + i * 5000, alt: 500 });
    const calls = [];
    window.terrainHasCoverage = () => true;
    window.terrainMaxAtLatLng = (lat, lng) => { calls.push(lat); return 100; };
    const c = document.createElement('canvas'); c.width = 400; c.height = 200;
    drawTrackProfile(c.getContext('2d'), 0, 0, 400, 200, pts, {});
    return { calls, n: Math.max(2, Math.round(tune('profileTerrainSamples'))) };
  });
  expect(r.calls.length).toBe(r.n + 1);
  // Half way along the plotted distance is half way along the flown line: lat 32.1.
  const mid = r.calls[Math.round(r.n / 2)];
  expect(Math.abs(mid - (32.0 + 0.2 * Math.round(r.n / 2) / r.n))).toBeLessThan(0.006);
});

test('a before-only route hint no longer beats a hint matching the next waypoint too', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    window.__ccm = { HUB: { commChange: true, routeHints: [
      { before: 'PREV', callSign: 'one' },
      { before: 'PREV', after: 'NEXT', callSign: 'two' },
    ] } };
    new Function('commChangeMap = window.__ccm;')();
    window.commRouteContextName = () => 'PREV';
    window.commRouteAfterNames = () => ['NEXT'];
    window.commCallSignOptionById = (name, id) => ({ id });
    window.commCallSignIdKey = id => id;
    window.commCallSignDefaultFromOption = opt => opt.id;
    state.waypoints = [{ lat: 32, lng: 34.8, name: 'PREV' }, { lat: 32.1, lng: 34.8, name: 'HUB' }];
    const differing = commRouteHintDefault({ name: 'HUB', index: 1 });
    window.__ccm.HUB.routeHints[1].callSign = 'one';
    const agreeing = commRouteHintDefault({ name: 'HUB', index: 1 });
    return { differing, agreeing };
  });
  // Both stay in the running: two different call signs are ambiguous, one shared is the answer.
  expect(r.differing).toBe(null);
  expect(r.agreeing).toBe('one');
});

test('?graphlegs=1 reloads the graph after a layer switch', async ({ page }) => {
  await boot(page, '&graphlegs=1');
  const got = await page.evaluate(async () => {
    window.routeGraphData = p => Promise.resolve({ nodes: {}, edges: {}, tag: p });
    new Function("_graphLegsGraph = null; _graphLegsLoading = false; navDataPrefix = 'cvfr';")();
    drawGraphLegs(); await new Promise(r => setTimeout(r, 0));
    const first = _graphLegsGraph && _graphLegsGraph.tag;
    navDataPrefix = 'lsa';
    drawGraphLegs(); await new Promise(r => setTimeout(r, 0));
    return { first, second: _graphLegsGraph && _graphLegsGraph.tag };
  });
  expect(got.first).toBe('cvfr');
  expect(got.second).toBe('lsa');
});

test('the NOTAM badge tap target follows the badge tunables', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const af = { icao: 'LLXX', lat: 32.2, lng: 34.9 };
    airfields = [af];
    window.airfieldByIcao = code => (code === 'LLXX' ? af : null);
    window.activeNotams = () => [{ icao: 'LLXX', id: 'N1' }];
    window.showNotam = true;
    setTune('notamBadgeOffsetPx', 34);
    const p = proj(af);
    const at = dy => notamBadgeNotamsAt(map.containerPointToLatLng([p.x, p.y + dy])).length;
    return { onBadge: at(34), oldSpot: at(14) };
  });
  expect(r.onBadge).toBe(1);
  expect(r.oldSpot).toBe(0);
});

test('exported measure label text sits inside its tunable padding and line height', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    setTune('measureLabelPadXPx', 20);
    setTune('measureLabelPadYPx', 15);
    setTune('measureLabelLineHeightPx', 30);
    window.measureLiveFrom = () => ({ lat: 32.1, lng: 34.85 });
    window.measure = { on: true, to: { lat: 32.15, lng: 34.95, name: 'TGT' } };
    // The label is placed within the canvas's on-page box, so the stand-in export canvas
    // needs one: laid over the map, invisible.
    const c = document.createElement('canvas'); c.width = 1280; c.height = 800;
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', width: '1280px',
      height: '800px', visibility: 'hidden' });
    document.body.appendChild(c);
    const ctx = c.getContext('2d');
    const texts = []; let box = null;
    const ft = ctx.fillText.bind(ctx);
    ctx.fillText = (t, x, y) => { texts.push({ t, x, y, base: ctx.textBaseline }); ft(t, x, y); };
    const rr = ctx.roundRect && ctx.roundRect.bind(ctx);
    ctx.roundRect = (x, y, w, h, rad) => { box = { x, y, w, h }; rr(x, y, w, h, rad); };
    const saved = octx; octx = ctx;
    try { drawMeasure(); } finally { octx = saved; c.remove(); }
    return { texts, box };
  });
  expect(r.box).not.toBe(null);
  expect(r.texts.length).toBe(2);
  r.texts.forEach((tx, i) => {
    expect(tx.x).toBeCloseTo(r.box.x + 20, 3);
    // The line's own band: padY + i*lineH .. padY + (i+1)*lineH (text anchored by its middle).
    const top = r.box.y + 15 + i * 30;
    expect(tx.y).toBeGreaterThanOrEqual(top);
    expect(tx.y).toBeLessThanOrEqual(top + 30);
    if (tx.base === 'top') expect(tx.y).toBeLessThanOrEqual(top + 30 - 13);
  });
});
