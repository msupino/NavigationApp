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
// The graph is the source now, so it is allowed to move on from the baseline -- but only
// where a human meant it to. Each entry names the undirected pair and the reason; any
// divergence NOT listed here is still a proof failure. This keeps the proof strict about
// accidents while letting the data live.
const INTENTIONAL_EDITS = {
  // Altitudes cross-referenced from a secondary source (Aug 2026) for links that were
  // status=unknown -- routable but with no published altitude read yet. status moved
  // unknown -> candidate; the chart read is still owed.
  'AMNON|HULAT': 'altitudes cross-referenced, pending chart read',
  'DUMIM|MIHMS': 'altitudes cross-referenced, pending chart read',
  'EITAN|TIRAT': 'altitudes cross-referenced, pending chart read',
  'ENGDI|MMORR': 'altitudes cross-referenced, pending chart read',
  'GALIM|KRYON': 'altitudes cross-referenced, pending chart read',
  'GALIM|GILAM': 'altitudes cross-referenced, pending chart read',
  'HAZVA|ZOFAR': 'altitudes cross-referenced, pending chart read',
  // AAKKO<->SMRAT: the flagged conflict (our OCR 700 both ways, the secondary source 400
  // both ways) resolved by the maintainer as a direction split: 700 toward SMRAT, 400
  // toward AAKKO. status=reviewed.
  'AAKKO|SMRAT': 'direction split resolved by the maintainer',
  // AYLON<->NSHRM: the mirror-image direction dispute resolved by the maintainer: 1200
  // toward NSHRM, 800 toward AYLON. Our OCR had it flipped; the secondary source agreed
  // with the resolution. status=reviewed.
  'AYLON|NSHRM': 'direction dispute resolved by the maintainer',
  // LSA: 34 unknown links filled the same way, and 9 symmetric OCR rows split into
  // per-direction values (the single OCR value matched one direction exactly; the other
  // direction was a copy, not a reading). The pair list lives in the graph's own `source`
  // strings; keyed here by the shared marker so the list does not have to be repeated.
  __lsaBySource: 'cross-referenced from a secondary source (Aug 2026)',
};

export function verify() {
  const problems = [];
  const intentional = [];
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
      // Every key the row carried, not a chosen few -- a hand-picked list is how a field
      // goes missing while the check stays green.
      for (const k of Object.keys(w)) {
        if (k === 'lat' || k === 'lng') {
          if (Math.abs(g[k] - w[k]) > 1e-4) problems.push(`${lay} ${w.name}: ${k} moved`);
        } else if (JSON.stringify(g[k]) !== JSON.stringify(w[k])) {
          problems.push(`${lay} ${w.name}.${k}: ${JSON.stringify(w[k])} -> ${JSON.stringify(g[k])}`);
        }
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
      // Every key the source row had, plus the ones the projection emits.
      const keys = [...new Set([...Object.keys(a), ...Object.keys(norm)])];
      // `oneWay: false` and an absent oneWay are the same statement; the sources use both.
      const same = (k) => {
        if (k === 'oneWay') return !!a[k] === !!norm[k];
        return JSON.stringify(a[k]) === JSON.stringify(norm[k]);
      };
      const bad = keys.filter(k => !same(k));
      // An edit is intentional when the pair is listed, or when the graph row itself says
      // its altitudes came from the cross-reference -- that marker is only ever written by
      // a deliberate data edit, never by the migration.
      const marked = norm.source && norm.source.includes(INTENTIONAL_EDITS.__lsaBySource) &&
        bad.every(k => ['inboundAltitude', 'outboundAltitude', 'status', 'source'].includes(k));
      if (bad.length && marked) {
        intentional.push(`${lay} ${a.from}<->${a.to}: cross-referenced altitudes`);
        continue;
      }
      if (bad.length && INTENTIONAL_EDITS[[a.from, a.to].sort().join('|')]) {
        intentional.push(`${lay} ${a.from}<->${a.to}: ` +
          INTENTIONAL_EDITS[[a.from, a.to].sort().join('|')]);
        continue;
      }
      if (bad.length) {
        problems.push(`${lay} ${a.from}->${a.to}: ${bad.join(', ')} differ ` +
          bad.map(k => `(${k}: ${JSON.stringify(a[k])} -> ${JSON.stringify(norm[k])})`).join(' '));
      }
    }
    // Field for field, not by count. Comparing only the count is how `routeHints` on 20
    // CVFR points survived this check while the projection dropped them: the count was
    // right and the data was gone.
    const srcCcFile = readOld(`${lay}-comm-change.json`);
    const srcCc = srcCcFile.points || [];
    const gotCcFile = commChangeFromGraph(graph);
    const gotCc = gotCcFile.points;
    if (srcCc.length !== gotCc.length) {
      problems.push(`${lay} comm-change points ${srcCc.length} -> ${gotCc.length}`);
    }
    const gotByName = new Map(gotCc.map(p => [p.name, p]));
    for (const a of srcCc) {
      const b = gotByName.get(a.name);
      if (!b) { problems.push(`${lay} comm-change point missing: ${a.name}`); continue; }
      for (const k of Object.keys(a)) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
          problems.push(`${lay} comm-change ${a.name}.${k} differs`);
        }
      }
    }
    // ...and the file-level keys, which carry the call-sign dictionary and the provenance.
    for (const k of Object.keys(srcCcFile)) {
      if (k === 'points') continue;
      if (JSON.stringify(srcCcFile[k]) !== JSON.stringify(gotCcFile[k])) {
        problems.push(`${lay} comm-change root.${k} differs`);
      }
    }
  }
  return { problems, intentional };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { problems, intentional } = verify();
  if (problems.length) {
    console.log(`NOT equivalent — ${problems.length} problem(s):`);
    for (const p of problems.slice(0, 40)) console.log('  ' + p);
    process.exitCode = 1;
  } else if (intentional.length) {
    console.log('equivalent, except ' + intentional.length +
      ' intentional edit(s) the graph made after the migration:');
    for (const p of intentional) console.log('  ' + p);
  } else {
    console.log('equivalent: every field the app reads is reproducible from the graph');
  }
}
