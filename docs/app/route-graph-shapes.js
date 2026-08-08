// Project a route graph back into the per-layer shapes the loaders validate.
//
// The nav-waypoints / leg-altitude / comm-change files are gone: each layer is now one
// `<layer>-route-graph.json`, and the same point is one node instead of up to four rows
// keyed by a name that did not match across layers. Nothing else changed -- the loaders,
// their validators and all 68 call sites still see the shapes they always saw, because
// they are rebuilt here.
//
// This is the ONLY implementation of that projection. The app, scripts/legacy-from-graph.mjs
// (which proves field for field that the projection loses nothing) and the dataset tests all
// come through here, so the app cannot drift from what the equivalence proof checked.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Which kinds are served from the graph. `areas` and `route-templates` are still files.
  const ROUTE_GRAPH_KINDS = { 'nav-waypoints': 1, 'leg-altitude': 1, 'comm-change': 1 };

  // CVFR's loader wants { waypoints: [...] } with en/he; heli and lsa want the looser
  // { points: [...] }. Each per-layer graph carries that layer's own name/report/position,
  // so a point shared with another layer still reads out as that layer describes it.
  function navWaypointsFromGraph(graph, layer) {
    const out = [];
    for (const id of Object.keys(graph.nodes || {})) {
      const n = graph.nodes[id];
      // An airfield can also be a layer's reporting point (heli lists מנחת קציעות). `layers`
      // records which waypoint files held it, so that -- not its kind -- decides membership.
      if (!Array.isArray(n.layers) || n.layers.indexOf(layer) < 0) continue;
      const row = { lat: n.lat, lng: n.lng, name: n.name || n.code || n.he };
      if (layer === 'cvfr') {
        if (n.en) row.en = n.en;
        if (n.he) row.he = n.he;
      } else if (n.he) {
        row.he = n.he;
      }
      if (n.report) row.report = n.report;
      out.push(row);
    }
    return layer === 'cvfr' ? { waypoints: out } : { points: out };
  }

  // One row per UNDIRECTED segment, in the direction the graph stores it. The graph holds
  // both directions with inbound/outbound swapped on the reverse; the legacy table held one.
  function legAltitudeFromGraph(graph) {
    const seen = {};
    const segments = [];
    const froms = Object.keys(graph.edges || {});
    for (let i = 0; i < froms.length; i++) {
      const from = froms[i];
      for (const e of graph.edges[from]) {
        if (e.blocked) continue;                  // the synthesised reverse of a one-way
        const key = [from, e.to].sort().join('|');
        if (seen[key]) continue;
        seen[key] = 1;
        const row = { from: from, to: e.to };
        // The published figure, kept only where a chart number is displayed. Routing weight
        // is computed from coordinates -- never from this.
        if (e.chartDistanceNm !== undefined) row.distanceNm = e.chartDistanceNm;
        row.inboundAltitude = e.inboundAltitude;
        row.outboundAltitude = e.outboundAltitude;
        if (e.oneWay) row.oneWay = true;
        if (e.status) row.status = e.status;
        if (e.source) row.source = e.source;
        if (e.armyAirway) row.armyAirway = e.armyAirway;
        if (e.onAtcApproval) row.onAtcApproval = e.onAtcApproval;
        if (e.detection) row.detection = e.detection;
        segments.push(row);
      }
    }
    segments.sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to));
    const out = {};
    for (const k of ['version', 'source', 'sourceCharts', 'schema']) {
      if (graph[k] !== undefined) out[k] = graph[k];
    }
    out.segments = segments;
    return out;
  }

  function commChangeFromGraph(graph) {
    const points = [];
    for (const id of Object.keys(graph.nodes || {})) {
      const n = graph.nodes[id];
      if (!n.commChange) continue;
      const row = { name: n.name || n.code || n.he, commChange: true };
      if (n.callSigns) row.callSigns = n.callSigns;
      points.push(row);
    }
    points.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const out = {};
    if (graph.callSigns) out.callSigns = graph.callSigns;
    out.points = points;
    return out;
  }

  function routeShapeFromGraph(kind, graph, layer) {
    if (kind === 'nav-waypoints') return navWaypointsFromGraph(graph, layer);
    if (kind === 'comm-change') return commChangeFromGraph(graph);
    if (kind === 'leg-altitude') return legAltitudeFromGraph(graph);
    throw new Error('not served from the route graph: ' + kind);
  }

  return { ROUTE_GRAPH_KINDS, routeShapeFromGraph,
    navWaypointsFromGraph, legAltitudeFromGraph, commChangeFromGraph };
});
