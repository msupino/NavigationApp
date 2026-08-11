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
  // 'airstrip': an LSA-only landing ground carried as a routable point -- it is not an
  // airfields.json field (no runways/plates/ATIS there) and not a plain reporting point.
  const kinds = new Set(Object.values(g.nodes).map(n => n.kind));
  expect([...kinds].sort()).toEqual(['airfield', 'airstrip', 'waypoint']);
  expect(g.nodes.LLNN.kind).toBe('airstrip');
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
    // activeNodes is 2 short of layerNodes: ZRANA and RANNO are locality labels the #410
    // chart rebuild misread as mandatory reporting points (plain circle on the chart, no
    // reporting-point triangle, and no route segment either way). They stay in the file
    // as active:false rather than being deleted -- both numbers are pinned so that
    // neither a stray deletion nor a stray flip of the flag can pass unreviewed.
    // +2 segments: MZDOT <-> MYTAR and MZDOT <-> ENGDI, 4000 ft both ways, CVFR only --
    // published CVFR legs the graph was simply missing, which is why MZDOT had no segment.
    cvfr: { layerNodes: 172, activeNodes: 170, segments: 271, commChange: 52, unknown: 6 },
    heli: { layerNodes: 209, activeNodes: 209, segments: 85, commChange: 0, unknown: 38 },
    // +9 nodes / +12 segments / +12 unknowns: GORAL, TAALL, MACHR and the six airstrips
    // from the second capture (#1485) -- the first census update under the new mechanism.
    lsa: { layerNodes: 176, activeNodes: 176, segments: 87, commChange: 0, unknown: 27 },
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
    const inLayer = Object.values(g.nodes).filter(n => n.layers.includes(lay));
    got[lay] = {
      layerNodes: inLayer.length,
      activeNodes: inLayer.filter(n => n.active !== false).length,
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

test('a corridor is not open one way and shut the other', () => {
  // Availability hints describe the CORRIDOR (a secondary source said it was shut, or that
  // it opens at 05:00), not a direction of travel -- but fplEdgeOpen reads them off the
  // directed edge, so an import that tagged only one direction leaves a segment routable
  // one way and refused the other. ESTOL <-> SORES was exactly that: no hints outbound,
  // closedHint + openFromHourHint:6 on the reverse, so the leg vanished in one direction.
  //
  // 14 more pairs still disagree. They are LISTED, not asserted away: each needs the chart
  // or the source checked, and pinning a guessed answer here would be worse than the gap.
  // This test holds the line at the one pair confirmed, and fails if it regresses.
  const g = graph();
  const FLAGS = ['closedHint', 'weekdayClosedHint', 'onAtcApproval', 'armyAirway',
                 'openFromHourHint'];
  const asym = [];
  const seen = new Set();
  for (const [from, es] of Object.entries(g.edges.cvfr)) {
    for (const e of es) {
      const k = [from, e.to].sort().join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      const rev = (g.edges.cvfr[e.to] || []).find(x => x.to === from);
      if (!rev) continue;
      if (FLAGS.some(f => String(e[f] || false) !== String(rev[f] || false))) asym.push(k);
    }
  }
  expect(asym).not.toContain('ESTOL|SORES');
  // The backlog is now the five closedHint pairs; every openFromHourHint asymmetry went
  // when that hint was dropped from this layer (see the test below).
  expect(asym.length).toBeLessThanOrEqual(5);
});

test('CVFR corridors carry no weekday opening hour', () => {
  // openFromHourHint came from two secondary captures (Aug 2026), not the AIP and not the
  // chart -- only two values exist anywhere, 05:00 and 06:00, which reads as a provider's
  // operating-hours field. An LSA bubble plausibly has activity hours; a published CVFR
  // green route does not, and the maintainer does not recognise the gate from the AIP.
  //
  // The capture bled onto CVFR through SHARED segments: 42 of the 51 CVFR pairs that
  // carried it were also heli/lsa segments, and 7 of the 9 CVFR-only ones were also the
  // asymmetric ones -- tagged in a single direction, clustered in the Arava/Eilat corridor.
  // It gated morning departures on a scraped hour, so it is gone from this layer.
  //
  // heli and lsa keep theirs: activity hours are real there, and that data is not in doubt.
  const g = graph();
  const gated = [];
  for (const [from, es] of Object.entries(g.edges.cvfr)) {
    for (const e of es) if (e.openFromHourHint !== undefined) gated.push(from + '->' + e.to);
  }
  expect(gated).toEqual([]);
  const others = ['heli', 'lsa'].map(lay => Object.values(g.edges[lay])
    .reduce((n, es) => n + es.filter(e => e.openFromHourHint !== undefined).length, 0));
  expect(others).toEqual([57, 71]);
});

test('MMORR to ARRAD is flyable one way only, westbound', () => {
  // A genuine one-way leg, 4000 ft, confirmed by the maintainer against the chart. Unlike
  // the hint asymmetries above this direction difference is REAL, so it is pinned rather
  // than flagged: MMORR (Mor, 35.368E) lies east of ARRAD (Arad Junction, 35.210E), and
  // only the westbound run is published.
  //
  // The stored shape follows the file's one-way convention exactly: the flyable entry
  // carries the altitude in outboundAltitude with inboundAltitude null and no `blocked`;
  // its mirror is the same figures swapped, plus blocked:true so no pass can traverse it.
  const g = layerGraph('cvfr');
  const fwd = g.edges.MMORR.find(e => e.to === 'ARRAD');
  const rev = g.edges.ARRAD.find(e => e.to === 'MMORR');
  expect(fwd.oneWay).toBe(true);
  expect(rev.oneWay).toBe(true);
  expect(fwd.blocked).toBeUndefined();          // westbound: the one you may fly
  expect(rev.blocked).toBe(true);               // eastbound: refused
  // The altitude of a direction lives in the entry's inboundAltitude (from -> to), which is
  // what the leg kite reads. Putting 4000 on the OTHER field left this leg routable with no
  // altitude, so it drew no kite -- the schema's "a single null means that direction is not
  // allowed" and a traversable edge cannot both be true of the same entry.
  expect(fwd.inboundAltitude).toBe(4000);
  expect(fwd.outboundAltitude).toBeNull();
  expect(rev.inboundAltitude).toBeNull();
  // Refusing a direction must not strand either end -- the way back exists, just longer.
  expect(g.edges.ARRAD.some(e => !e.blocked && e.to === 'HATRU')).toBe(true);
});
