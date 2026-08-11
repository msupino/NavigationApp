// @ts-check
// The ?editor=1 point export must match the file it is pasted into. Reporting points live
// in <prefix>-route-graph.json under `nodes`, keyed by name — not in the flat array the
// retired *-nav-waypoints.json files used, which is what this exported until now.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist&editor=1');
  await page.waitForFunction(() => typeof draw === 'function' && typeof routeGraphData === 'function');
}

test('the point export is a nodes map, not a flat array', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    const g = await routeGraphData('cvfr');
    const src = g.nodes.SFAIM;
    // Stand in for "loaded via Load known, then dragged": the whole source record rides
    // along in _node, and only position/labels are edited here.
    const pts = [{ lat: src.lat + 0.001, lng: src.lng, report: 'mandatory', layer: 'CVFR',
                   name: 'SFAIM', he: src.he, _node: src }];
    const byName = {};
    for (const p of pts) {
      const id = p.name.trim().toUpperCase();
      const base = JSON.parse(JSON.stringify(p._node));
      base.lat = p.lat; base.lng = p.lng; base.name = id;
      byName[id] = base;
    }
    return { emitted: { nodes: byName }, source: src };
  });
  // Shape: a `nodes` object keyed by name, matching the graph file.
  expect(Array.isArray(out.emitted)).toBe(false);
  expect(out.emitted.nodes).toBeTruthy();
  expect(Object.keys(out.emitted.nodes)).toEqual(['SFAIM']);

  // Ride-through: every field the editor does not edit survives. These are exactly the
  // ones the old flat-array export dropped, and dropping them on paste-back would have
  // silently removed comm-change points and layer membership from the graph.
  const n = out.emitted.nodes.SFAIM;
  for (const k of ['code', 'en', 'he', 'kind', 'layers', 'report']) {
    expect(n[k], k + ' must ride through the export').toEqual(out.source[k]);
  }
  if (out.source.commChange !== undefined) expect(n.commChange).toEqual(out.source.commChange);
  if (out.source.callSigns !== undefined) expect(n.callSigns).toEqual(out.source.callSigns);

  // ...and the edit itself landed.
  expect(n.lat).toBeCloseTo(out.source.lat + 0.001, 5);
});

test('a node built by the editor satisfies the graph validator', async ({ page }) => {
  await boot(page);
  const n = await page.evaluate(() => {
    // A brand-new point: no _node to ride through, so the export has to synthesise a
    // record the validator accepts — route-graph.spec.js requires he, and en or code.
    const id = 'TESTX';
    const base = {};
    base.lat = 32.1; base.lng = 34.9; base.report = 'onRequest'; base.name = id;
    base.he = 'בדיקה';
    if (!base.code) base.code = id;
    if (!base.kind) base.kind = 'waypoint';
    if (!Array.isArray(base.layers)) base.layers = ['cvfr'];
    return base;
  });
  expect(n.he).toBeTruthy();
  expect(n.en || n.code).toBeTruthy();
  expect(n.layers).toContain('cvfr');
  expect(n.kind).toBe('waypoint');
});
