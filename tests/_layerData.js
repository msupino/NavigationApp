// Test-side access to the per-layer datasets, which are no longer files.
//
// nav-waypoints, leg-altitude and comm-change now come from <layer>-route-graph.json, so a
// spec that used to `require('../docs/data/cvfr-nav-waypoints.json')` asks for the same
// shape here instead. The projection is the app's own (docs/app/route-graph-shapes.js) --
// a test that reimplemented it would stop testing what ships.
//
// `graphFixture()` goes the other way: the specs that stub the dataset fetch still express
// their fixtures in the legacy shape, which is the readable one, and it wraps them into the
// graph the app now asks for.
const fs = require('fs');
const path = require('path');
const shapes = require('../docs/app/route-graph-shapes.js');

const DATA = path.join(__dirname, '..', 'docs', 'data');
// One request goes out per layer now, so one glob covers all three kinds.
const ROUTE_GRAPH_GLOB = '**/cvfr-route-graph.json*';
const graphGlob = (layer) => `**/${layer}-route-graph.json*`;

const _cache = {};
function routeGraph(layer = 'cvfr') {
  if (!_cache[layer]) {
    _cache[layer] = JSON.parse(fs.readFileSync(path.join(DATA, `${layer}-route-graph.json`), 'utf8'));
  }
  return _cache[layer];
}

// The shapes the loaders validate, rebuilt from the shipped graph.
const navWaypoints = (layer = 'cvfr') => shapes.navWaypointsFromGraph(routeGraph(layer), layer);
const legAltitude = (layer = 'cvfr') => shapes.legAltitudeFromGraph(routeGraph(layer));
const commChange = (layer = 'cvfr') => shapes.commChangeFromGraph(routeGraph(layer));
// CVFR's list is `waypoints`; heli and lsa use `points`.
const waypointRows = (layer = 'cvfr') => {
  const d = navWaypoints(layer);
  return d.waypoints || d.points;
};

// Build a graph file out of legacy-shaped fixtures. Only the fields the projection reads are
// set: a fixture that omits comm-change or segments simply yields a graph without them.
function graphFixture({ layer = 'cvfr', waypoints = [], segments = [], commChange: cc = [],
  callSigns, version, source, sourceCharts, schema } = {}, fillCoords = true) {
  const nodes = {};
  // No lat/lng here: a comm-change or segment fixture names a point without positioning it,
  // and merging a 0/0 over the shipped node would move it into the Gulf of Guinea. They are
  // filled in at the end, only for a graph that has no real nodes underneath it.
  // `layers` is waypoint-file membership, and only the waypoints fixture confers it: a point
  // named by a comm-change or segment fixture is not thereby a nav waypoint. It never was --
  // and as one it fails the CVFR schema, which requires en/he on every waypoint row.
  const node = (id, isWaypoint) => {
    const n = (nodes[id] = nodes[id] || { layers: [] });
    if (isWaypoint && n.layers.indexOf(layer) < 0) n.layers.push(layer);
    return n;
  };
  for (const w of waypoints) {
    const id = w.name;
    const n = node(id, true);
    n.lat = w.lat; n.lng = w.lng;
    n.name = w.name;
    if (w.en) n.en = w.en;
    if (w.he) n.he = w.he;
    if (w.report) n.report = w.report;
  }
  for (const c of cc) {
    const n = node(c.name);
    // Every key the fixture set, not a chosen few: the specs exercise `from`/`to`/`note`
    // branches that a hand-picked list would quietly drop.
    Object.assign(n, c);
    n.name = c.name;
    n.commChange = true;
  }
  // Both directions, altitudes swapped on the reverse -- the projection drops the reverse
  // again, so a fixture that only stored one way would still round-trip, but the graph the
  // app loads is the two-way one and the other consumers of it read both.
  const edges = {};
  const push = (a, b, e) => { (edges[a] = edges[a] || []).push({ to: b, ...e }); };
  for (const s of segments) {
    node(s.from); node(s.to);
    const common = {};
    for (const k of ['status', 'source', 'armyAirway', 'onAtcApproval', 'detection']) {
      if (s[k] !== undefined) common[k] = s[k];
    }
    if (s.oneWay) common.oneWay = true;
    if (s.distanceNm !== undefined) common.chartDistanceNm = s.distanceNm;
    common.distanceNm = s.distanceNm !== undefined ? s.distanceNm : 1;
    push(s.from, s.to, { ...common,
      inboundAltitude: s.inboundAltitude, outboundAltitude: s.outboundAltitude });
    push(s.to, s.from, { ...common, blocked: true,
      inboundAltitude: s.outboundAltitude, outboundAltitude: s.inboundAltitude });
  }
  if (fillCoords) {
    for (const n of Object.values(nodes)) {
      if (typeof n.lat !== 'number') { n.lat = 0; n.lng = 0; }
    }
  }
  const g = { layer, nodes, edges };
  if (callSigns) g.callSigns = callSigns;
  for (const [k, v] of Object.entries({ version, source, sourceCharts, schema })) {
    if (v !== undefined) g[k] = v;
  }
  return g;
}

// Stub the dataset fetch for a spec: one route handler instead of three.
//
// A spec used to install a fixture per file, and several install two. One file now serves
// all three kinds, so the calls ACCUMULATE into a single fixture rather than the last one
// registered winning -- which would silently blank whichever kind was stubbed first.
//
// The default REPLACES ONLY THE KINDS THE FIXTURE SUPPLIES, over the shipped graph. That is
// what stubbing one file used to mean: a spec that stubbed comm-change kept the real nav
// waypoints and the real leg network, and its assertions were written against them. Serving
// a fixture-only graph blanks the other two kinds instead -- which is a boot timeout on
// `window.navWP.length > 0`, not a visible wrong answer. Pass `base: 'none'` for a graph
// that holds nothing but the fixture.
const _stubs = new WeakMap();
async function stubGraph(page, fixture = {}, layer = 'cvfr') {
  let acc = _stubs.get(page);
  if (!acc) {
    acc = { layer, waypoints: [], segments: [], commChange: [], callSigns: undefined,
      base: 'real' };
    _stubs.set(page, acc);
    // Serialised per request, so a stub installed after this handler still takes effect.
    await page.route(graphGlob(layer), route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(_merged(acc)),
    }));
  }
  if (fixture.base) acc.base = fixture.base;
  for (const k of ['waypoints', 'segments', 'commChange']) {
    if (Array.isArray(fixture[k])) acc[k] = acc[k].concat(fixture[k]);
  }
  for (const k of ['callSigns', 'version', 'source', 'sourceCharts', 'schema']) {
    if (fixture[k] !== undefined) acc[k] = fixture[k];
  }
}

function _merged(acc) {
  if (acc.base !== 'real') return graphFixture(acc);
  const g = graphFixture(acc, false);
  const real = routeGraph(acc.layer);
  const nodes = {};
  for (const [id, n] of Object.entries(real.nodes)) {
    const copy = { ...n };
    // A comm-change fixture REPLACES the shipped comm-change points -- a spec that asserts
    // "three points" must not also see the shipped 52.
    if (acc.commChange.length) { delete copy.commChange; delete copy.callSigns; }
    nodes[id] = copy;
  }
  for (const [id, n] of Object.entries(g.nodes)) {
    const prev = nodes[id];
    // Union the membership: a comm-change fixture names TYONA without claiming it is not a
    // waypoint, and overwriting `layers` with the fixture's empty list un-draws its ring.
    const layers = [...new Set([...((prev && prev.layers) || []), ...(n.layers || [])])];
    nodes[id] = { ...(prev || {}), ...n, layers };
  }
  // A fixture point the shipped graph does not carry still needs a position to be drawable.
  for (const n of Object.values(nodes)) {
    if (typeof n.lat !== 'number') { n.lat = 0; n.lng = 0; }
  }
  // Same for the leg network: a segments fixture is the whole network, not an addition.
  const edges = acc.segments.length ? {} : { ...real.edges };
  for (const [id, es] of Object.entries(g.edges)) edges[id] = (edges[id] || []).concat(es);
  const out = { ...real, nodes, edges };
  for (const k of ['callSigns', 'version', 'source', 'sourceCharts', 'schema']) {
    if (acc[k] !== undefined) out[k] = acc[k];
  }
  return out;
}

module.exports = { routeGraph, navWaypoints, legAltitude, commChange, waypointRows,
  graphFixture, stubGraph, ROUTE_GRAPH_GLOB, graphGlob };
