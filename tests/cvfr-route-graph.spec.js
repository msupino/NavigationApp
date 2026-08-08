// @ts-check
// The CVFR low-level network as a graph, joined from datasets the repo already ships.
// A filed routes plan names the reporting-point codes "as they appear on the back of the
// route charts" (AIP א'-11, annex א' legend), so producing that chain needs the corridor
// topology, not just the points the pilot clicked.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const graph = () => JSON.parse(
  fs.readFileSync(path.join(ROOT, 'docs', 'data', 'cvfr-route-graph.json'), 'utf8'));
const builder = () => import(
  path.join(ROOT, 'scripts', 'build-cvfr-route-graph.mjs'));

test('the published graph is complete and internally consistent', () => {
  const g = graph();
  expect(g.counts.segments).toBeGreaterThan(200);
  // Every endpoint a segment names must have a position, or the point cannot be drawn.
  expect(g.positionless).toEqual([]);
  expect(g.counts.droppedSegments).toBe(0);
  // Both directions are stored: altitudes are direction-dependent, and a route flown the
  // other way must resolve without the caller reversing anything itself.
  expect(g.counts.directedEdges).toBe(g.counts.segments * 2);
  for (const [from, edges] of Object.entries(g.edges)) {
    expect(g.nodes[from], from + ' has edges but no position').toBeTruthy();
    for (const e of edges) {
      expect(g.nodes[e.to], e.to + ' is a destination but has no position').toBeTruthy();
      const back = (g.edges[e.to] || []).find(x => x.to === from);
      expect(back, from + '->' + e.to + ' has no reverse').toBeTruthy();
      // The reverse swaps inbound/outbound, exactly as legAltitudeForLeg() resolves it.
      expect(back.inboundAltitude).toBe(e.outboundAltitude);
      expect(back.outboundAltitude).toBe(e.inboundAltitude);
    }
  }
});

test('the checked-in graph matches what the builder produces', async () => {
  // The data is generated, so it can drift from its sources without anyone noticing.
  const { buildRouteGraph } = await builder();
  const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'data', f), 'utf8'));
  const list = (d, key) => (Array.isArray(d) ? d : (d && d[key]) || []);
  const fresh = buildRouteGraph({
    segments: list(read('cvfr-leg-altitude.json'), 'segments'),
    waypoints: list(read('cvfr-nav-waypoints.json'), 'waypoints'),
    airfields: list(read('airfields.json'), 'airfields'),
  });
  const onDisk = graph();
  expect(fresh.counts).toEqual(onDisk.counts);
  expect(fresh.edges).toEqual(onDisk.edges);
  expect(fresh.nodes).toEqual(onDisk.nodes);
});

test('expanding between a pilot\'s picks reproduces a real filed route', async () => {
  const { expandBetween } = await builder();
  const g = graph();
  const chain = (picks) => {
    const out = [];
    for (let i = 0; i < picks.length - 1; i++) {
      const seg = expandBetween(g, picks[i], picks[i + 1]);
      if (!seg) return null;
      out.push(...(i ? seg.slice(1) : seg));
    }
    return out;
  };
  // Filed through flp.co.il for 4XDAZ on 2026-08-07, Herzliya out to Kfar HaNagid and back.
  const filedOut = 'LLHZ SFAIM APOLN ARENA HTZUK RIDNG CLORE TYONA SUPER NTAIM BOVED NAGID'.split(' ');
  const filedBack = 'NAGID BOVED NTAIM SUPER TYONA CLORE RIDNG HTZUK KNTRY LLHZ'.split(' ');
  expect(chain(['LLHZ', 'ARENA', 'SUPER', 'NAGID'])).toEqual(filedOut);
  expect(chain(['NAGID', 'SUPER', 'KNTRY', 'LLHZ'])).toEqual(filedBack);
});

test('expansion runs between picks, because end-to-end routing files the wrong corridor', async () => {
  const { expandBetween } = await builder();
  const g = graph();
  // The cheapest path from LLHZ to NAGID goes inland and skips the coastal points the pilot
  // actually flew. Routing the whole flight would file a route that was not flown -- the
  // same defect class as a mirrored return.
  const cheapest = expandBetween(g, 'LLHZ', 'NAGID');
  expect(cheapest).not.toContain('APOLN');
  expect(cheapest).not.toContain('ARENA');
  // ...while the pilot's own picks pull it back onto the coast.
  expect(expandBetween(g, 'LLHZ', 'ARENA')).toEqual(['LLHZ', 'SFAIM', 'APOLN', 'ARENA']);
});

test('an unreachable pair resolves to nothing rather than to an invented chain', async () => {
  const { expandBetween } = await builder();
  const g = graph();
  expect(expandBetween(g, 'LLHZ', 'NOSUCHPT')).toBeNull();
  // A point resolves to itself without inventing a leg.
  expect(expandBetween(g, 'LLHZ', 'LLHZ')).toEqual(['LLHZ']);
});

test('airfields are tagged, because a landing mid-route needs its own plan', () => {
  const g = graph();
  // AIP א'-11 and the filing desk both treat an intermediate landing as a separate flight
  // plan per leg; a caller expanding a route has to be able to see one without a second
  // lookup. LLHZ and KNTRY sit on the same corridor and are not the same kind of thing.
  expect(g.nodes.LLHZ.kind).toBe('airfield');
  expect(g.nodes.KNTRY.kind).toBe('waypoint');
  const kinds = new Set(Object.values(g.nodes).map(n => n.kind));
  expect([...kinds].sort()).toEqual(['airfield', 'waypoint']);
});
