#!/usr/bin/env node
// One route graph for all three networks: CVFR, helicopter and LSA.
//
// The same reporting point is described in up to four files today -- its waypoint record,
// the endpoints of its altitude segments, the comm-change list, and airfields.json -- each
// keyed by a NAME. And the key is not the same kind of thing across layers: CVFR names
// points by their five-letter code, while many LSA and heli points carry only a Hebrew
// name, because they were mapped by hand from the charts with no code list to hand.
//
// That is why searching for the AIP annex א' sample's points BY CODE found 4 of 17 and
// looked like missing coverage, while searching BY POSITION found 12 of the 13 "missing"
// ones sitting in the LSA and heli files. Nodes are therefore deduplicated by position.
//
// Edges stay grouped PER LAYER and are never merged: a CVFR flight expanded through a heli
// corridor would file a route it is not cleared for, and it would look plausible.
//
//   node scripts/build-route-graph.mjs [--codes <flight-maps.json>]
//   node scripts/build-route-graph.mjs --check
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'docs', 'data');
const OUT = lay => join(DATA, lay + '-route-graph.json');
const LAYERS = ['cvfr', 'heli', 'lsa'];

// Two points within this MAY be the same point -- the merge also has to agree on identity
// (see canMerge). 0.1 nm was too tight: 74 same-named pairs sat between 0.10 and 0.20 nm,
// the same junction digitised twice from different charts. Identity is what makes the wider
// radius safe; distance alone would eventually fuse two genuinely different points.
export const SAME_POINT_NM = 0.25;
// A cross-referenced code is accepted only when it is this close AND the runner-up is
// clearly further: an ambiguous match is left un-coded rather than guessed.
export const CODE_MATCH_NM = 0.35;
export const CODE_RUNNERUP_NM = 0.6;

const read = f => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const rows = (d, ...keys) => {
  if (Array.isArray(d)) return d;
  for (const k of keys) if (Array.isArray(d && d[k])) return d[k];
  return [];
};
const isCode = s => /^[A-Z0-9]{2,7}$/.test(String(s || ''));

export function distanceNm(a, b) {
  const R = 3440.065, rad = Math.PI / 180;
  const la1 = a.lat * rad, la2 = b.lat * rad;
  const dLa = (b.lat - a.lat) * rad, dLo = (b.lng - a.lng) * rad;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// A stable id for a point with no code: the Hebrew name is the only handle we have, so it
// has to produce the same id on every build.
function slugId(he, lat, lng) {
  const base = String(he || '').replace(/\s+/g, '-');
  return base ? ('he:' + base) : ('at:' + lat.toFixed(5) + ',' + lng.toFixed(5));
}

export function buildRouteGraph(input) {
  const { waypoints, segments, commChange, airfields, codeRef } = input;
  const nodes = [];                       // { code, he, en, lat, lng, kind, layers:Set, ... }

  // Same place AND not contradicting each other: two published points with different codes
  // are different points however close they sit, and so are two different Hebrew names.
  const canMerge = (n, name) => {
    if (!name) return true;
    if (isCode(name)) return !n.code || n.code === name;
    return !n.he || n.he === name;
  };

  const findNear = (lat, lng, within, name) => {
    let best = null, bestD = Infinity;
    for (const n of nodes) {
      const d = distanceNm({ lat, lng }, n);
      if (d < bestD && canMerge(n, name)) { bestD = d; best = n; }
    }
    return bestD <= within ? best : null;
  };

  const upsert = (w, layer, kind) => {
    if (!w || !Number.isFinite(w.lat) || !Number.isFinite(w.lng)) return null;
    const name = String(w.name || '').trim();
    const n = findNear(w.lat, w.lng, SAME_POINT_NM, name) || (() => {
      const fresh = { code: null, he: null, en: null, lat: w.lat, lng: w.lng,
        kind: kind || 'waypoint', layers: new Set(), report: null };
      nodes.push(fresh);
      return fresh;
    })();
    n.layers.add(layer);
    if (isCode(name)) { if (!n.code) n.code = name; }
    else if (name && !n.he) n.he = name;
    if (w.he && !n.he) n.he = w.he;
    if (w.en && !n.en) n.en = w.en;
    if (w.report && !n.report) n.report = w.report;
    if (kind === 'airfield') n.kind = 'airfield';   // a field outranks a plain point
    return n;
  };

  for (const lay of LAYERS) for (const w of waypoints[lay] || []) upsert(w, lay, 'waypoint');
  for (const a of airfields || []) upsert(a, 'airfield', 'airfield');

  // Cross-referenced codes for points that have none. Only the CODE is taken -- never a
  // position, a segment or a distance -- and only on an unambiguous position match.
  let crossRef = 0, conflicts = [];
  if (codeRef && codeRef.length) {
    for (const n of nodes) {
      const cands = codeRef
        .map(c => ({ d: distanceNm(n, c), code: c.code }))
        .sort((x, y) => x.d - y.d);
      const best = cands[0], second = cands[1];
      if (!best || best.d > CODE_MATCH_NM) continue;
      if (second && second.d <= CODE_RUNNERUP_NM) continue;      // ambiguous: leave it
      if (!n.code) { n.code = best.code; n.codeSource = 'cross-referenced'; crossRef++; }
      else if (n.code !== best.code) {
        // Ours wins; theirs is recorded so the disagreement can be audited rather than
        // silently resolved in either direction.
        n.codeAlt = best.code;
        conflicts.push([n.code, best.code, n.he || n.en || '']);
      }
    }
  }

  // A shared CODE is stronger identity evidence than a spelling. "צ. ברכיה" (heli) and
  // "צומת ברכיה" (lsa) are the same junction 0.10 nm apart, but the abbreviation blocked the
  // name-aware merge above; both then cross-referenced to ZBRCH, which settles it. Merge
  // once the codes are known.
  const merged = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    if (!a || !a.code) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      if (!b || b.code !== a.code) continue;
      if (distanceNm(a, b) > CODE_MATCH_NM) continue;      // same code, but a different place
      for (const l of b.layers) a.layers.add(l);
      if (!a.he && b.he) a.he = b.he;
      if (!a.en && b.en) a.en = b.en;
      if (!a.report && b.report) a.report = b.report;
      if (b.kind === 'airfield') a.kind = 'airfield';
      merged.push([a.code, b.he || '']);
      nodes[j] = null;
    }
  }
  for (let i = nodes.length - 1; i >= 0; i--) if (!nodes[i]) nodes.splice(i, 1);

  // Comm change is a property of the POINT, not a separate file keyed by a name that does
  // not match across layers.
  let commApplied = 0, commUnmatched = [];
  for (const lay of LAYERS) {
    for (const c of commChange[lay] || []) {
      const name = String(c.name || '').trim();
      const n = nodes.find(x => (x.code && x.code === name) || (x.he && x.he === name));
      if (!n) { commUnmatched.push(name); continue; }
      if (c.commChange) n.commChange = true;
      if (Array.isArray(c.callSigns) && c.callSigns.length) n.callSigns = c.callSigns.slice();
      commApplied++;
    }
  }

  // Ids: the code where there is one, else a stable slug. Assigned after all merging, so an
  // id never depends on the order the sources were read in.
  const idOf = new Map();
  const out = {};
  const taken = new Map();          // id -> how many nodes have claimed it
  const collisions = [];
  for (const n of nodes) {
    let id = n.code || slugId(n.he, n.lat, n.lng);
    // Two DISTINCT points can want the same id: the same Hebrew name used at two junctions,
    // or the same code appearing in two layers at positions further apart than the merge
    // threshold. Assigning both and writing to out[id] silently dropped one -- 414 merged
    // points came out as 335 nodes. Disambiguate and record it instead.
    if (taken.has(id)) {
      const nth = taken.get(id) + 1;
      taken.set(id, nth);
      collisions.push([id, n.lat, n.lng]);
      id = id + '#' + nth;
    } else {
      taken.set(id, 1);
    }
    idOf.set(n, id);
    out[id] = {
      ...(n.code ? { code: n.code } : {}),
      ...(n.codeSource ? { codeSource: n.codeSource } : {}),
      ...(n.codeAlt ? { codeAlt: n.codeAlt } : {}),
      ...(n.he ? { he: n.he } : {}),
      ...(n.en ? { en: n.en } : {}),
      lat: n.lat, lng: n.lng, kind: n.kind,
      ...(n.report ? { report: n.report } : {}),
      ...(n.commChange ? { commChange: true } : {}),
      ...(n.callSigns ? { callSigns: n.callSigns } : {}),
      layers: [...n.layers].filter(l => l !== 'airfield').sort(),
    };
  }

  // Edges, per layer. An endpoint is resolved by NAME within its own layer first, then by
  // position -- the altitude files key on the same names their waypoint file uses.
  const edges = {};
  const unresolved = [];
  for (const lay of LAYERS) {
    const e = {};
    for (const s of segments[lay] || []) {
      if (!s || !s.from || !s.to) continue;
      const find = (nm) => {
        const hit = nodes.find(n => (n.code && n.code === nm) || (n.he && n.he === nm));
        return hit ? idOf.get(hit) : null;
      };
      const a = find(String(s.from).trim()), b = find(String(s.to).trim());
      if (!a || !b) { unresolved.push([lay, s.from, s.to]); continue; }
      const push = (from, to, reverse) => {
        const na = out[from], nb = out[to];
        (e[from] = e[from] || []).push({
          to,
          inboundAltitude: reverse ? (s.outboundAltitude ?? null) : (s.inboundAltitude ?? null),
          outboundAltitude: reverse ? (s.inboundAltitude ?? null) : (s.outboundAltitude ?? null),
          // Computed from the coordinates: the stored figure is the derived one, rounded to
          // 0.1, so it cannot be the routing weight without importing that rounding.
          distanceNm: Math.round(distanceNm(na, nb) * 100) / 100,
          // ...while the chart's own number rides along where a chart value is displayed.
          ...(Number.isFinite(s.distanceNm) ? { chartDistanceNm: s.distanceNm } : {}),
          ...(s.oneWay === true ? { oneWay: true, ...(reverse ? { blocked: true } : {}) } : {}),
          ...(s.status ? { status: s.status } : {}),
        });
      };
      push(a, b, false);
      push(b, a, true);
    }
    for (const k of Object.keys(e)) e[k].sort((x, y) => x.to.localeCompare(y.to));
    edges[lay] = e;
  }

  // One SELF-CONTAINED file per layer. Sharing a node between layers is a modelling fact,
  // but shipping one merged file would mean every consumer loads all three networks and
  // could route across them by accident. A per-layer file cannot: the other layers' edges
  // are not in it. A node used by two layers appears in both files, identically.
  const perLayer = {};
  for (const lay of LAYERS) {
    const used = new Set(Object.keys(edges[lay]));
    for (const es of Object.values(edges[lay])) for (const e of es) used.add(e.to);
    for (const n of nodes) if (n.layers.has(lay)) used.add(idOf.get(n));
    const ns = {};
    for (const id of [...used].sort()) if (out[id]) ns[id] = out[id];
    perLayer[lay] = { layer: lay, nodes: ns, edges: edges[lay] };
  }

  const counts = {
    nodes: Object.keys(out).length,
    sourceRows: LAYERS.reduce((n, l) => n + (waypoints[l] || []).length, 0) + (airfields || []).length,
    shared: Object.values(out).filter(n => n.layers.length > 1).length,
    coded: Object.values(out).filter(n => n.code).length,
    crossReferenced: crossRef,
    codeConflicts: conflicts.length,
    commChangePoints: Object.values(out).filter(n => n.commChange).length,
    segments: Object.fromEntries(LAYERS.map(l =>
      [l, Object.values(edges[l]).reduce((n, a) => n + a.length, 0) / 2])),
    unresolvedSegments: unresolved.length,
    idCollisions: collisions.length,
    mergedByCode: merged.length,
    perLayerNodes: Object.fromEntries(LAYERS.map(l => [l, Object.keys(perLayer[l].nodes).length])),
  };
  return { counts, conflicts, collisions, unresolved, commUnmatched, nodes: out, edges, perLayer };
}

function loadAll(codeRefPath) {
  const waypoints = {}, segments = {}, commChange = {};
  for (const lay of LAYERS) {
    waypoints[lay] = rows(read(`${lay}-nav-waypoints.json`), 'waypoints', 'points');
    segments[lay] = rows(read(`${lay}-leg-altitude.json`), 'segments');
    commChange[lay] = rows(read(`${lay}-comm-change.json`), 'points', 'changes');
  }
  const airfields = rows(read('airfields.json'), 'airfields');
  let codeRef = [];
  if (codeRefPath && existsSync(codeRefPath)) {
    codeRef = JSON.parse(readFileSync(codeRefPath, 'utf8'))
      .filter(c => c && isCode(c.code) && Number.isFinite(c.lat) && Number.isFinite(c.lng));
  }
  return { waypoints, segments, commChange, airfields, codeRef };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ci = process.argv.indexOf('--codes');
  const graph = buildRouteGraph(loadAll(ci > -1 ? process.argv[ci + 1] : null));
  const bodies = Object.fromEntries(LAYERS.map(l =>
    [l, JSON.stringify(graph.perLayer[l], null, 1)]));
  if (process.argv.includes('--check')) {
    let stale = [];
    for (const l of LAYERS) {
      let cur = null;
      try { cur = readFileSync(OUT(l), 'utf8'); } catch (e) { /* missing */ }
      if (!cur || JSON.stringify(JSON.parse(cur), null, 1) !== bodies[l]) stale.push(l);
    }
    console.log(stale.length
      ? stale.map(l => l + '-route-graph.json').join(', ') + ' STALE — re-run without --check'
      : 'up to date');
    process.exitCode = stale.length ? 1 : 0;
  } else {
    for (const l of LAYERS) { writeFileSync(OUT(l), bodies[l] + '\n'); console.log('wrote', OUT(l)); }
    console.log(JSON.stringify(graph.counts, null, 1));
    if (graph.conflicts.length) console.log('code conflicts:', graph.conflicts);
    if (graph.unresolved.length) console.log('unresolved segments:', graph.unresolved.slice(0, 10));
    if (graph.commUnmatched.length) console.log('comm-change points with no node:', graph.commUnmatched);
  }
}
