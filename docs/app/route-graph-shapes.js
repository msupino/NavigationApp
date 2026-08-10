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
      // `active: false` keeps a row the chart rebuild got wrong without deleting the
      // research behind it -- the coordinates and both names stay, with the reason, so a
      // later chart edition can flip one boolean instead of re-deriving the point. Absent
      // means active: every node predates the field, and a row is a real point by default.
      // Honoured HERE because this projection is the only thing that surfaces a node to the
      // pilot; the routing consumers read edges, and an inactive node has none.
      if (n.active === false) continue;
      const row = { lat: n.lat, lng: n.lng, name: n.name || n.code || n.he };
      // `en` for every layer, not just CVFR. 93 LSA and 105 heli points are the same
      // published point as a CVFR one and already carry its English name; dropping it here
      // is why an English session showed them in Hebrew.
      //
      // Where no English NAME exists, the code stands in -- it is what the back of the route
      // charts prints for that point, so a pilot reads back something real. A transliterated
      // Hebrew name would read better and would be invented, which on a reporting point is
      // the wrong trade. Points with neither stay Hebrew.
      if (n.en || n.code) row.en = n.en || n.code;
      if (n.he) row.he = n.he;
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
      // routeHints match the waypoints adjacent to the point to a call sign, so the app can
      // tell which station to call in the direction actually being flown. They are per
      // point, and 20 CVFR points carry them.
      if (n.routeHints) row.routeHints = n.routeHints;
      if (n.note) row.note = n.note;
      if (n.source) row.source = n.source;
      // Legacy per-point frequency labels. No shipped point carries them any more (the
      // call-sign dictionary replaced them), but the shape still allows them.
      if (n.from) row.from = n.from;
      if (n.to) row.to = n.to;
      points.push(row);
    }
    // The published order, which known-freq-points.md mirrors row for row. Anything the
    // order does not mention keeps a stable alphabetical tail.
    const order = (graph.commMeta && graph.commMeta.pointOrder) || [];
    const rank = {};
    order.forEach((nm, i) => { rank[nm] = i; });
    points.sort((a, b) => {
      const ra = rank[a.name], rb = rank[b.name];
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return String(a.name).localeCompare(String(b.name));
    });
    const out = {};
    // The retired file's own provenance keys (version, source, the _NOTE commentary a
    // maintainer reads) ride along, so the shape is the one the validator documents.
    if (graph.commMeta) {
      for (const k of Object.keys(graph.commMeta)) {
        if (k !== 'pointOrder') out[k] = graph.commMeta[k];   // pointOrder is not part of the shape
      }
    }
    // Always present, even empty: heli and lsa list no comm-change points at all, and their
    // loaders still read the dictionary.
    out.callSigns = graph.callSigns || {};
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
