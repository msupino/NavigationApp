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
// A merged view for the cross-layer checks. A shared point appears in several files with
// that layer's own spelling, and only the layer that carries it flags things like
// commChange -- so this UNIONS the copies instead of letting the last file overwrite the
// rest, which silently dropped 32 of the 52 comm-change points. Anything positional is
// checked per file, against that file's own nodes.
const graph = () => {
  const nodes = {}, edges = {};
  for (const l of ['cvfr', 'heli', 'lsa']) {
    const g = layerGraph(l);
    for (const [id, n] of Object.entries(g.nodes)) {
      const prev = nodes[id];
      nodes[id] = prev ? { ...prev, ...n, commChange: prev.commChange || n.commChange,
        callSigns: prev.callSigns || n.callSigns } : { ...n };
      if (!nodes[id].commChange) delete nodes[id].commChange;
      if (!nodes[id].callSigns) delete nodes[id].callSigns;
    }
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
    // That layer's OWN nodes: a shared point can sit at a slightly different charted
    // position in another layer's file, and the weight belongs to this file's geometry.
    const own = layerGraph(lay).nodes;
    for (const [from, es] of Object.entries(g.edges[lay])) {
      for (const e of es) {
        // The stored figure is the derived one rounded to 0.1; the weight has to come from
        // the coordinates or it imports that rounding into every route total.
        expect(e.distanceNm).toBeCloseTo(gc(own[from], own[e.to]), 1);
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

test('every CVFR node carries the labels its validator requires', () => {
  // validateNavWaypoints treats en and he as required strings on the cvfr prefix. The old
  // file made that invariant visible in every row; in a hand-edited graph it is implicit,
  // and one node added without a Hebrew label would alert on every draw. Pin it here.
  const g = layerGraph('cvfr');
  const bad = Object.entries(g.nodes)
    .filter(([, n]) => n.layers.includes('cvfr'))
    .filter(([, n]) => !(n.en || n.code) || !n.he)
    .map(([id]) => id);
  expect(bad).toEqual([]);
});

test('a shared node keeps one identity across the files that carry it', () => {
  // A point shared by layers ships as a copy in each layer's file. The copies are
  // deliberately NOT identical -- each file carries its own chart's position, spelling and
  // reporting class -- but the IDENTITY must be one: the code a plan files, what kind of
  // thing it is, and the layers list that says the copies exist at all. Nothing but this
  // test enforces that: the graph is hand-maintained, and an edit that lands in one file
  // and misses a twin would otherwise ship silently.
  const files = {};
  for (const l of LAYERS) files[l] = layerGraph(l).nodes;
  const where = {};
  for (const [l, ns] of Object.entries(files)) {
    for (const id of Object.keys(ns)) (where[id] = where[id] || []).push(l);
  }
  const R = 3440.065, rad = Math.PI / 180;
  const gc = (a, b) => {
    const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const problems = [];
  for (const [id, ls] of Object.entries(where)) {
    if (ls.length < 2) continue;
    const first = files[ls[0]][id];
    for (const l of ls.slice(1)) {
      const other = files[l][id];
      for (const k of ['code', 'codeSource', 'kind']) {
        if (JSON.stringify(first[k]) !== JSON.stringify(other[k])) {
          problems.push(`${id}.${k}: ${ls[0]}=${JSON.stringify(first[k])} vs ${l}=${JSON.stringify(other[k])}`);
        }
      }
      if (JSON.stringify([...(first.layers || [])].sort()) !==
          JSON.stringify([...(other.layers || [])].sort())) {
        problems.push(`${id}.layers: ${ls[0]} and ${l} disagree`);
      }
      // Per-layer positions may differ (each chart digitised its own), but only within the
      // merge radius that made them one node in the first place.
      if (gc(first, other) > 0.25) {
        problems.push(`${id}: copies ${gc(first, other).toFixed(2)} nm apart`);
      }
    }
    // ...and the layers list must match reality: every file it names carries the node.
    const claimed = [...new Set((files[ls[0]][id].layers || []))].filter(l => LAYERS.includes(l));
    for (const l of claimed) {
      if (!files[l] || !files[l][id]) problems.push(`${id}.layers names ${l}, which lacks the node`);
    }
  }
  expect(problems).toEqual([]);
});

test('airfields are tagged, because a landing mid-route needs its own plan', () => {
  // Carried over from the retired cvfr-route-graph.spec.js: the app resolves mid-route
  // airfields against airfields.json, but the graph's own tagging is the data audit that
  // catches a published field slipping in as a plain waypoint.
  const g = graph();
  expect(g.nodes.LLHZ.kind).toBe('airfield');
  expect(g.nodes.KNTRY.kind).toBe('waypoint');
  const kinds = new Set(Object.values(g.nodes).map(n => n.kind));
  expect([...kinds].sort()).toEqual(['airfield', 'waypoint']);
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

test('the data census matches what the maintainer last signed off', () => {
  // The graph is the source of truth and is edited by hand. These pins replace the old
  // equivalence proof against the retired per-layer files: that proof guarded the
  // MIGRATION, and once the data started growing past the baseline every legitimate edit
  // joined an exception ledger. Instead, an edit now has to touch ONE line here -- which
  // is the point: an accidental deletion or duplication fails this test, a deliberate
  // change updates the census in the same diff a reviewer reads.
  const expected = {
    cvfr: { layerNodes: 172, segments: 269, commChange: 52, unknown: 6 },
    heli: { layerNodes: 209, segments: 85, commChange: 0, unknown: 38 },
    lsa: { layerNodes: 167, segments: 75, commChange: 0, unknown: 15 },
  };
  const got = {};
  for (const lay of LAYERS) {
    const g = layerGraph(lay);
    const seen = new Set();
    let unknown = 0;
    for (const [f, es] of Object.entries(g.edges)) {
      for (const e of es) {
        if (e.blocked) continue;
        const k = [f, e.to].sort().join('|');
        if (seen.has(k)) continue;
        seen.add(k);
        if (e.status === 'unknown') unknown++;
      }
    }
    got[lay] = {
      layerNodes: Object.values(g.nodes).filter(n => n.layers.includes(lay)).length,
      segments: seen.size,
      commChange: Object.values(g.nodes).filter(n => n.commChange).length,
      unknown,
    };
  }
  expect(got).toEqual(expected);
});

test('the safety-critical rows read exactly what the chart says', () => {
  // Spot pins on the rows where a silent change misleads a pilot: a one-way corridor flown
  // backwards, or a charted altitude drifting. The census above catches bulk accidents;
  // these catch a surgical one.
  const g = layerGraph('cvfr');
  const edge = (a, b) => (g.edges[a] || []).find(e => e.to === b);
  // HTZUK -> Country Club: 1200, one-way; the reverse is synthesised and blocked.
  expect(edge('HTZUK', 'KNTRY')).toMatchObject({ inboundAltitude: 1200, oneWay: true });
  expect(edge('HTZUK', 'KNTRY').outboundAltitude).toBeNull();
  expect(edge('KNTRY', 'HTZUK').blocked).toBe(true);
  // Herzliya's one-way departure corridor: out via SFAIM at 1200, never back.
  expect(edge('LLHZ', 'SFAIM')).toMatchObject({ inboundAltitude: 1200, oneWay: true });
  // A comm-change node keeps its call signs.
  expect(g.nodes.BASAN.commChange).toBe(true);
  expect(g.nodes.BASAN.callSigns).toContain('PLUTO_EAST');
});
