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
  callSigns, version, source, sourceCharts, schema } = {}) {
  const nodes = {};
  const node = (id) => (nodes[id] = nodes[id] || { layers: [layer], lat: 0, lng: 0 });
  for (const w of waypoints) {
    const id = w.name;
    const n = node(id);
    n.lat = w.lat; n.lng = w.lng;
    n.name = w.name;
    if (w.en) n.en = w.en;
    if (w.he) n.he = w.he;
    if (w.report) n.report = w.report;
  }
  for (const c of cc) {
    const n = node(c.name);
    n.name = c.name;
    n.commChange = true;
    if (c.callSigns) n.callSigns = c.callSigns;
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
// Pass `base: 'real'` to start from the shipped graph and only add to it.
const _stubs = new WeakMap();
async function stubGraph(page, fixture = {}, layer = 'cvfr') {
  let acc = _stubs.get(page);
  if (!acc) {
    acc = { layer, waypoints: [], segments: [], commChange: [], callSigns: undefined, base: null };
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
  const g = graphFixture(acc);
  if (acc.base !== 'real') return g;
  const real = routeGraph(acc.layer);
  const nodes = { ...real.nodes };
  for (const [id, n] of Object.entries(g.nodes)) nodes[id] = { ...(nodes[id] || {}), ...n };
  const edges = { ...real.edges };
  for (const [id, es] of Object.entries(g.edges)) edges[id] = (edges[id] || []).concat(es);
  return { ...real, ...g, nodes, edges };
}

module.exports = { routeGraph, navWaypoints, legAltitude, commChange, waypointRows,
  graphFixture, stubGraph, ROUTE_GRAPH_GLOB, graphGlob };
