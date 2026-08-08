// @ts-check
// One graph for CVFR, heli and LSA. The same point is described in up to four files today,
// each keyed by a name -- and the key is a five-letter code in CVFR but a Hebrew name in
// much of LSA and heli, which is how the AIP annex א' sample's points looked "missing" when
// searched by code and turned up by position.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// One self-contained file per layer: a consumer physically cannot route across layers.
const layerGraph = (lay) => JSON.parse(
  fs.readFileSync(path.join(ROOT, 'docs', 'data', lay + '-route-graph.json'), 'utf8'));
const graph = () => {
  const nodes = {}, edges = {};
  for (const l of ['cvfr', 'heli', 'lsa']) {
    const g = layerGraph(l);
    Object.assign(nodes, g.nodes);
    edges[l] = g.edges;
  }
  return { nodes, edges };
};
const LAYERS = ['cvfr', 'heli', 'lsa'];

test('every layer keeps its own edges, and none of them cross', () => {
  const g = graph();
  expect(Object.keys(g.edges).sort()).toEqual([...LAYERS].sort());
  // Each file names its layer and carries only that layer's edges -- the guarantee is
  // structural, not a convention a caller has to remember.
  for (const lay of LAYERS) {
    const one = layerGraph(lay);
    expect(one.layer).toBe(lay);
    for (const es of Object.values(one.edges)) {
      for (const e of es) expect(one.nodes[e.to], e.to + ' missing from ' + lay + ' file').toBeTruthy();
    }
  }
  // The hard rule: a CVFR flight expanded through a heli corridor would file a route it is
  // not cleared for, and it would look plausible. There is no merged edge list, and every
  // endpoint of every edge exists as a node.
  for (const lay of LAYERS) {
    for (const [from, es] of Object.entries(g.edges[lay])) {
      expect(g.nodes[from], from + ' has ' + lay + ' edges but is not a node').toBeTruthy();
      for (const e of es) expect(g.nodes[e.to], e.to + ' is a destination but not a node').toBeTruthy();
    }
  }
});

test('both directions are stored, with the altitudes swapped on the reverse', () => {
  const g = graph();
  for (const lay of LAYERS) {
    for (const [from, es] of Object.entries(g.edges[lay])) {
      for (const e of es) {
        const back = (g.edges[lay][e.to] || []).find(x => x.to === from);
        expect(back, from + '->' + e.to + ' (' + lay + ') has no reverse').toBeTruthy();
        expect(back.inboundAltitude).toBe(e.outboundAltitude);
        expect(back.outboundAltitude).toBe(e.inboundAltitude);
        // ...and the reverse of a one-way segment is marked, not merely absent.
        if (e.oneWay) expect(back.oneWay).toBe(true);
      }
    }
  }
});

test('routing distance is computed; the chart figure rides along as an annotation', () => {
  const g = graph();
  const R = 3440.065, rad = Math.PI / 180;
  const gc = (a, b) => {
    const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  let checked = 0;
  for (const lay of LAYERS) {
    for (const [from, es] of Object.entries(g.edges[lay])) {
      for (const e of es) {
        // The stored figure is the derived one rounded to 0.1; the weight has to come from
        // the coordinates or it imports that rounding into every route total.
        expect(e.distanceNm).toBeCloseTo(gc(g.nodes[from], g.nodes[e.to]), 1);
        if (e.chartDistanceNm !== undefined) {
          expect(Math.abs(e.chartDistanceNm - e.distanceNm)).toBeLessThan(0.6);
          checked++;
        }
      }
    }
  }
  expect(checked).toBeGreaterThan(100);
});

test('points shared by several layers are one node, not several', () => {
  const g = graph();
  const shared = Object.entries(g.nodes).filter(([, n]) => n.layers.length > 1);
  expect(shared.length).toBeGreaterThan(100);
  // ZMGID is a CVFR reporting point that the heli network also uses.
  expect(g.nodes.ZMGID).toBeTruthy();
  expect(g.nodes.ZMGID.layers).toContain('cvfr');
  // No two nodes may sit on the same spot: that is the duplication this file removes.
  const R = 3440.065, rad = Math.PI / 180;
  const ids = Object.keys(g.nodes);
  for (let i = 0; i < ids.length; i++) {
    const a = g.nodes[ids[i]];
    for (let j = i + 1; j < ids.length; j++) {
      const b = g.nodes[ids[j]];
      if (Math.abs(a.lat - b.lat) > 0.02 || Math.abs(a.lng - b.lng) > 0.02) continue;
      const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
        Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
      const d = 2 * R * Math.asin(Math.sqrt(h));
      if (d <= 0.25) {
        // Allowed only when they disagree on identity -- two published points that really
        // are different things at nearly the same place.
        const sameCode = a.code && b.code && a.code === b.code;
        const sameHe = a.he && b.he && a.he === b.he;
        expect(sameCode || sameHe,
          `${ids[i]} and ${ids[j]} are ${d.toFixed(2)} nm apart and not distinguished`).toBe(false);
      }
    }
  }
});

test('comm change lives on the node, with its call signs', () => {
  const g = graph();
  const withComm = Object.values(g.nodes).filter(n => n.commChange);
  expect(withComm.length).toBe(52);            // every CVFR comm-change point found a node
  for (const n of withComm) {
    expect(Array.isArray(n.callSigns)).toBe(true);
    expect(n.callSigns.length).toBeGreaterThan(0);
  }
  expect(g.nodes.BASAN.commChange).toBe(true);
  expect(g.nodes.BASAN.callSigns).toContain('PLUTO_EAST');
});

test('cross-referenced codes are labelled, and conflicts keep both', () => {
  const g = graph();
  const xref = Object.values(g.nodes).filter(n => n.codeSource === 'cross-referenced');
  // Codes for LSA/heli points that were mapped by hand from the charts with no code list.
  expect(xref.length).toBeGreaterThan(40);
  for (const n of xref) {
    expect(n.code).toMatch(/^[A-Z0-9]{2,7}$/);
    // The authority is the back of the published route charts (AIP א'-11 annex א'); these
    // are a convenience pending that audit, and the label is what keeps it auditable.
    expect(n.codeSource).toBe('cross-referenced');
  }
  // Where the two sources disagree, ours stands and theirs is recorded rather than dropped.
  const conflicted = Object.values(g.nodes).filter(n => n.codeAlt);
  for (const n of conflicted) expect(n.code).not.toBe(n.codeAlt);
});

test('the shipped graph still says what the retired CVFR table said', () => {
  // The per-layer files it was built from are gone, so the baseline is the last commit that
  // had them -- the same one scripts/legacy-from-graph.mjs proves equivalence against. This
  // is what stops a later edit to the graph from quietly dropping a published segment.
  const { execFileSync } = require('child_process');
  const src = JSON.parse(execFileSync('git',
    ['show', 'e3cd65e:docs/data/cvfr-leg-altitude.json'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  const segs = src.segments || src;
  const pairs = new Set();
  for (const [from, es] of Object.entries(graph().edges.cvfr)) for (const e of es) pairs.add(from + '>' + e.to);
  let found = 0;
  for (const s2 of segs) {
    if (!s2.from || !s2.to) continue;
    if (pairs.has(s2.from + '>' + s2.to) || pairs.has(s2.to + '>' + s2.from)) found++;
  }
  expect(found).toBe(segs.length);
});

test('every field the app reads is still reproducible from the graph', () => {
  // The proof that made deleting the source files safe, run on every CI pass rather than
  // once by hand: the loaders keep receiving the shapes they validate, field for field.
  const { execFileSync } = require('child_process');
  const out = execFileSync('node', ['scripts/legacy-from-graph.mjs'],
    { cwd: ROOT, encoding: 'utf8' });
  expect(out).toContain('equivalent');
});
