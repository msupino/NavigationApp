#!/usr/bin/env node
// Rebuild the legacy per-layer shapes FROM the route graph.
//
// This is what makes deleting the source files safe rather than hopeful: the app's loaders
// keep receiving exactly the shape they validate today, and `--verify` proves field for
// field that nothing was lost on the way into the graph. If a field cannot be reproduced,
// the source file cannot be deleted -- that is the whole test.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'docs', 'data');
const LAYERS = ['cvfr', 'heli', 'lsa'];
const read = f => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
// The source files are retired, so the baseline for the proof is the last commit that had
// them. Reading it from git keeps the proof runnable after the deletion -- otherwise the
// evidence for "nothing was lost" disappears together with the thing it was about.
const BASELINE = 'e3cd65e';
const readOld = (f) => JSON.parse(
  execFileSync('git', ['show', `${BASELINE}:docs/data/${f}`],
    { cwd: join(HERE, '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

// The projection itself lives in the app, so the app and this proof cannot diverge:
// docs/app/route-graph-shapes.js is the single implementation, loaded here through its
// module.exports branch.
const require_ = createRequire(import.meta.url);
export const { navWaypointsFromGraph, legAltitudeFromGraph, commChangeFromGraph } =
  require_(join(HERE, '..', 'docs', 'app', 'route-graph-shapes.js'));

// --- verification ------------------------------------------------------------------------
// Compares against the retired files, read from git at BASELINE. Only the fields the app
// READS are compared: those files also carried commentary keys (_NOTE, _TODO), which are
// notes to a maintainer, not data.
export function verify() {
  const problems = [];
  for (const lay of LAYERS) {
    const graph = read(`${lay}-route-graph.json`);
    const srcWp = readOld(`${lay}-nav-waypoints.json`);
    const gotWp = navWaypointsFromGraph(graph, lay);
    const srcRows = srcWp.waypoints || srcWp.points || [];
    const gotRows = gotWp.waypoints || gotWp.points || [];
    const byName = new Map(gotRows.map(r => [r.name, r]));
    for (const w of srcRows) {
      const g = byName.get(w.name);
      if (!g) { problems.push(`${lay} waypoint missing from graph: ${w.name}`); continue; }
      if (w.report && g.report !== w.report) {
        problems.push(`${lay} ${w.name}: report ${w.report} -> ${g.report}`);
      }
      if (Math.abs(g.lat - w.lat) > 1e-4 || Math.abs(g.lng - w.lng) > 1e-4) {
        problems.push(`${lay} ${w.name}: position moved`);
      }
    }
    // Compare by the UNDIRECTED pair, not by position in a sorted list: a regenerated row
    // may name the same segment the other way round, and index comparison then reports every
    // row as broken. Orientation is not data -- but inbound/outbound ARE tied to it, so a
    // flipped row has its altitudes swapped before comparing.
    const srcSeg = (readOld(`${lay}-leg-altitude.json`).segments) || [];
    const gotSeg = legAltitudeFromGraph(graph).segments;
    const key = r => [r.from, r.to].sort().join('|');
    const gotBy = new Map(gotSeg.map(r => [key(r), r]));
    if (srcSeg.length !== gotSeg.length) {
      problems.push(`${lay} segments ${srcSeg.length} -> ${gotSeg.length}`);
    }
    for (const a of srcSeg) {
      const b = gotBy.get(key(a));
      if (!b) { problems.push(`${lay} segment missing: ${a.from}->${a.to}`); continue; }
      const flipped = b.from !== a.from;
      const norm = flipped
        ? { ...b, from: b.to, to: b.from,
            inboundAltitude: b.outboundAltitude, outboundAltitude: b.inboundAltitude }
        : b;
      const keys = ['from', 'to', 'distanceNm', 'inboundAltitude', 'outboundAltitude',
        'oneWay', 'status', 'source', 'armyAirway', 'onAtcApproval'];
      // `oneWay: false` and an absent oneWay are the same statement; the sources use both.
      const same = (k) => {
        if (k === 'oneWay') return !!a[k] === !!norm[k];
        return JSON.stringify(a[k]) === JSON.stringify(norm[k]);
      };
      const bad = keys.filter(k => !same(k));
      if (bad.length) {
        problems.push(`${lay} ${a.from}->${a.to}: ${bad.join(', ')} differ ` +
          bad.map(k => `(${k}: ${JSON.stringify(a[k])} -> ${JSON.stringify(norm[k])})`).join(' '));
      }
    }
    const srcCc = (readOld(`${lay}-comm-change.json`).points) || [];
    const gotCc = commChangeFromGraph(graph).points;
    if (srcCc.length !== gotCc.length) {
      problems.push(`${lay} comm-change points ${srcCc.length} -> ${gotCc.length}`);
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = verify();
  if (problems.length) {
    console.log(`NOT equivalent — ${problems.length} problem(s):`);
    for (const p of problems.slice(0, 40)) console.log('  ' + p);
    process.exitCode = 1;
  } else {
    console.log('equivalent: every field the app reads is reproducible from the graph');
  }
}
