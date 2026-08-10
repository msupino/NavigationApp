// @ts-check
// Regression coverage for the docs/data/cvfr-nav-waypoints.json content
// (issues #406 and #408 — and now #410, the image-based rebuild).
//
// The dataset was originally rebuilt from the published IAA CVFR chart
// waypoint reference table (page 113, 2025 edition, shipped upstream as
// `113_waypoints.csv`). The legacy KMZ-derived JSON had ~91 stale
// codes (`AREA *`, `LLHA A/B/C`, `LLMG A/B Maarav/Mizrah`, etc.) and a
// handful of reporting points with chart-disagreeing coords — notably
// BEZRA (~752 m) and KUVSH (~648 m), the heading-drift culprits.
//
// PR #410 then rebuilt cvfr-nav-waypoints.json a second time directly from a
// high-resolution screenshot of the published chart, replacing the CSV
// extraction that had introduced typesetting artefacts (digit `2` where
// Hebrew samekh `ס` belonged, missing final-letter forms, and a few
// outright spelling errors like `קיריון` vs `קריון` and `רווחה` vs
// `רוחה`). The chart screenshot is now the source of truth.
//
// These checks live as a Playwright spec rather than a Node-only test
// because the existing test plumbing (_setup.js) is Playwright-based and
// reusing it keeps the harness consistent. The actual assertions are
// purely against the parsed JSON content — no browser interaction.

const { test, expect } = require('./_setup');

// The dataset is projected from cvfr-route-graph.json now; the shape is unchanged.
const { navWaypoints } = require('./_layerData');

function loadData() {
  return navWaypoints('cvfr');
}

test.describe('#406 / #410 — cvfr-nav-waypoints.json (chart-sourced)', () => {
  test('parses and exposes the expected entry count', async () => {
    const d = loadData();
    expect(Array.isArray(d.waypoints)).toBe(true);
    // 199 chart rows: 26 ARP (filtered out, see airfields.json) + 172
    // reporting points (89 mandatory + 84 on-request, less LLMZ which
    // moved to airfields.json as the Bar Yehuda / Masada airfield),
    // less ZRANA + RANNO -- locality labels the rebuild misread as
    // reporting points. Those two are still IN the graph, carrying
    // active:false; this projection is what drops them, which is why
    // the census in route-graph.spec.js still counts 172 rows.
    expect(d.waypoints.length).toBe(170);
  });

  test('every entry carries name + en + he + lat + lng', async () => {
    const d = loadData();
    for (const w of d.waypoints) {
      expect(typeof w.name).toBe('string');
      expect(typeof w.en).toBe('string');
      expect(typeof w.he).toBe('string');
      expect(w.en.trim()).not.toBe('');
      expect(w.en).not.toBe(w.name);
      expect(typeof w.lat).toBe('number');
      expect(typeof w.lng).toBe('number');
      // Israel rough bounding box — catches accidental column swaps or
      // sign flips at build time without being so tight that the CSV
      // can't include a stray neighbour-airspace point in future.
      expect(w.lat).toBeGreaterThan(29);
      expect(w.lat).toBeLessThan(34);
      expect(w.lng).toBeGreaterThan(33);
      expect(w.lng).toBeLessThan(36.5);
    }
  });

  test('every entry carries a valid reporting class', async () => {
    const d = loadData();
    for (const w of d.waypoints) {
      // 'mandatory' (חובה) or 'onRequest' (דרישה), from the chart's
      // 'סוג דיווח' column.
      expect(['mandatory', 'onRequest']).toContain(w.report);
    }
  });

  test('reporting-class split matches the chart (87 mandatory / 83 on-request)', async () => {
    const d = loadData();
    const mandatory = d.waypoints.filter(w => w.report === 'mandatory').length;
    const onRequest = d.waypoints.filter(w => w.report === 'onRequest').length;
    expect(mandatory).toBe(87);      // was 89 before ZRANA + RANNO were dropped
    expect(onRequest).toBe(83);
  });

  test('codes are unique', async () => {
    const d = loadData();
    const codes = d.waypoints.map(w => w.name);
    const seen = new Set();
    const dupes = [];
    for (const c of codes) {
      if (seen.has(c)) dupes.push(c);
      seen.add(c);
    }
    expect(dupes).toEqual([]);
  });

  test('does NOT include airfield ARP codes (covered by airfields.json)', async () => {
    const d = loadData();
    const codes = new Set(d.waypoints.map(w => w.name));
    // ICAO airfield codes live in airfields.json. Including them here
    // would mean two overlay markers (white dot + blue triangle) per
    // airfield and confuse the snap-priority logic in applyNavSnap().
    // LLMZ (Bar Yehuda / Masada) is an airfield and lives in
    // airfields.json, so it must not appear here either.
    for (const code of ['LLBG', 'LLHZ', 'LLHA', 'LLER', 'LLES', 'LLEV',
                        'LLEY', 'LLFK', 'LLIB', 'LLKS', 'LLKZ', 'LLMG',
                        'LLRS', 'LLBS', 'LLEK', 'LLRM', 'LLRD', 'LLNV',
                        'LLOV', 'LLHS', 'LLHB', 'LLPL', 'LLBO', 'LLMZ']) {
      expect(codes.has(code)).toBe(false);
    }
  });

  test('BEZRA + KUVSH carry chart coords — heading-drift regression', async () => {
    const d = loadData();
    const bezra = d.waypoints.find(w => w.name === 'BEZRA');
    const kuvsh = d.waypoints.find(w => w.name === 'KUVSH');
    // Chart values (rounded to 5 dp). Pre-#406 cvfr-nav-waypoints.json had
    // BEZRA at (31.73525, 34.64917) — ~752 m south of the chart — and
    // KUVSH at (31.26444, 34.76361) — ~648 m north of the chart. Both
    // shifts caused ~1° heading drift on cross-country legs that pass
    // through them.
    expect(bezra).toEqual({ name: 'BEZRA', en: 'Beit Ezra', he: 'בית עזרא',
                            lat: 31.74139, lng: 34.64583, report: 'mandatory' });
    expect(kuvsh).toEqual({ name: 'KUVSH', en: 'Kovshim', he: 'כובשים',
                            lat: 31.25861, lng: 34.76361, report: 'mandatory' });
  });

  test('English display names are meaningful labels, not only chart codes', async () => {
    const d = loadData();
    const byCode = new Map(d.waypoints.map(w => [w.name, w]));
    expect(byCode.get('SDTYM').en).toBe('Sdot Yam');
    expect(byCode.get('DEROR').en).toBe('Bnei Dror');
    expect(byCode.get('NMASD').en).toBe('Ashdod Port');
    expect(byCode.get('RIDNG').en).toBe('Riding');
    expect(byCode.get('ZLHAV').en).toBe('Lehavim Junction');
  });

  // Spot checks that the image-based rebuild (#410) replaced the
  // CSV-derived text artefacts, with selected labels aligned to the
  // arielbider/cvfr-map reference data used for cross-checking.
  test('chart-correct Hebrew names (#410 — image/upstream-sourced)', async () => {
    const d = loadData();
    const byCode = new Map(d.waypoints.map(w => [w.name, w]));
    // CSV had digit `2` where the chart prints Hebrew samekh `ס`.
    expect(byCode.get('OSNAT').he).toBe('אסנת');
    expect(byCode.get('SAMAR').he).toBe('סמר');
    expect(byCode.get('SAHAR').he).toBe('סער');
    expect(byCode.get('SIGAL').he).toBe('סיגל');
    expect(byCode.get('PARDS').he).toBe('פרדס');
    expect(byCode.get('SUPER').he).toBe('סופרלנד');
    expect(byCode.get('HRGVS').he).toBe('הר גבס');
    expect(byCode.get('HASID').he).toBe('כפר חסידים');
    expect(byCode.get('SIRNI').he).toBe('נצר סירני');
    expect(byCode.get('FRDIS').he).toBe('צומת פורדיס');
    // Spelling fixes vs the legacy CSV / upstream comparison.
    expect(byCode.get('AFULA').he).toBe('צומת עפולה');
    expect(byCode.get('KRYON').he).toBe('קיריון');
    expect(byCode.get('REVAH').he).toBe('רווחה');
    expect(byCode.get('SIZFN').he).toBe('שזפון');
    expect(byCode.get('MEHOL').he).toBe('משולש חולית');
  });

  // Hebrew final-letter forms (issue #408).
  //
  // The chart CSV ships non-final letter forms (כ, מ, נ, פ, צ) even at
  // end-of-word, which is wrong typographically. We rewrite them to the
  // final forms (ך, ם, ן, ף, ץ) at every word boundary. A "word boundary"
  // here means: end-of-string OR followed by any non-Hebrew character.
  test('every he field uses final-letter forms at end of word', async () => {
    const d = loadData();
    // Match a non-final letter that is NOT followed by another Hebrew
    // letter — i.e. a non-final at end-of-word. After the fix this regex
    // must NOT match any he field.
    const nonFinalAtEow = /[כמנפצ](?![\u05D0-\u05EA\u05F0-\u05F2])/;
    const offenders = [];
    for (const w of d.waypoints) {
      if (nonFinalAtEow.test(w.he)) {
        offenders.push({ name: w.name, he: w.he });
      }
    }
    expect(offenders).toEqual([]);
  });

  test('newly-surfaced codes (PR #405 flagged) are present', async () => {
    const d = loadData();
    const codes = new Set(d.waypoints.map(w => w.name));
    // The reporting-required work (#405) and earlier comm-change work
    // surfaced these codes as missing from the legacy KMZ-derived JSON.
    // The chart-sourced CSV carries them all.
    //
    // ZRANA and RANNO were on this list too, and are deliberately off it now --
    // see 'locality labels are not reporting points' below.
    for (const code of ['NASIH', 'ZGOAL', 'MESEK', 'METAH',
                        'ZURIM', 'TZHOT']) {
      expect(codes.has(code)).toBe(true);
    }
  });

  test('locality labels are not reporting points', async () => {
    const d = loadData();
    const codes = new Set(d.waypoints.map(w => w.name));
    // The page-113 reference table lists town names alongside reporting points, and
    // the chart-screenshot rebuild (#410) took two of them for mandatory points:
    // ZRANA (רעננה מרכז, Ra'anana Center) and RANNO (רעננה צפון, Ra'anana North).
    //
    // On the published chart both carry only the plain locality circle. A reporting
    // point carries the triangle -- GNYAM (גני עם, Ganei Am) sits a little south of
    // them and has one. The data agreed: neither had a single route segment in or
    // out, while all 83 on-request points and the other 87 mandatory ones do.
    //
    // They are marked active:false in the graph rather than deleted, so the chart
    // research survives if a later edition promotes them. This asserts the projection
    // honours the flag -- if it stopped, both would reappear in search and on the map.
    for (const code of ['ZRANA', 'RANNO']) {
      expect(codes.has(code), code + ' is a locality label, not a reporting point').toBe(false);
    }
    // The point that IS published there stays.
    expect(codes.has('GNYAM')).toBe(true);
  });

  test('a node with no segments says why, and is never assumed to be an artefact', async () => {
    // Seven CVFR nodes carried no route segment at all, and it is tempting to read that
    // as one fault. It was three, and only the first is a data error:
    //
    //   ZRANA, RANNO            locality labels, never reporting points  -> active:false
    //   GILAT, MESEK, METAH,    published points on MILITARY routes the
    //   ZURIM                   civil graph does not carry               -> noSegmentsReason
    //   MZDOT                   real CVFR legs missing from the graph    -> segments added
    //
    // The middle group is the trap: they look identical to the first in the data, and
    // deleting them would remove published reporting points. Every segment-less node must
    // therefore carry an explanation, so the next person auditing this cannot guess.
    const { routeGraph } = require('./_layerData');
    const g = routeGraph('cvfr');
    const fanIn = new Set();
    for (const es of Object.values(g.edges)) for (const e of es) fanIn.add(e.to);
    const segmentless = Object.keys(g.nodes)
      .filter(id => !g.edges[id] && !fanIn.has(id)).sort();
    expect(segmentless).toEqual(['GILAT', 'MESEK', 'METAH', 'RANNO', 'ZRANA', 'ZURIM']);
    for (const id of segmentless) {
      const n = g.nodes[id];
      expect(n.active === false || !!n.noSegmentsReason,
        id + ' has no segments and does not say why').toBe(true);
    }
    // MZDOT is no longer among them: its published legs were added, not explained away.
    expect(g.edges.MZDOT.map(e => e.to).sort()).toEqual(['ENGDI', 'MYTAR']);
  });

  test('a node is active unless it says otherwise', async () => {
    // Fail-open by design: `active` postdates every row in the file, so a node without
    // it is a real point. A typo'd or absent flag must never silently hide a published
    // reporting point -- only an explicit `false` removes one.
    const { routeGraph } = require('./_layerData');
    const g = routeGraph('cvfr');
    const inactive = Object.entries(g.nodes).filter(([, n]) => n.active === false);
    expect(inactive.map(([id]) => id).sort()).toEqual(['RANNO', 'ZRANA']);
    // Every inactive row explains itself, and carries no segments to route through.
    for (const [id, n] of inactive) {
      expect(n.inactiveReason, id + ' must say why it is inactive').toBeTruthy();
      expect(g.edges[id], id + ' is inactive but has outbound segments').toBeFalsy();
    }
    // Nothing else uses a falsy-but-not-false value that `!== false` would let through.
    for (const [id, n] of Object.entries(g.nodes)) {
      if ('active' in n) expect(typeof n.active, id + '.active must be boolean').toBe('boolean');
    }
  });

  test('legacy stale codes are dropped', async () => {
    const d = loadData();
    const codes = new Set(d.waypoints.map(w => w.name));
    // Representative spot-check of the 92 codes the legacy KMZ carried
    // that no longer appear on the published chart. Listing all 92 in
    // the spec would be noise; the count assertion above and these
    // probes together pin the diff down.
    for (const code of ['AREA 3', 'AREA 11', 'LLHA A', 'LLHA B', 'LLHA C',
                        'LLMG A Maarav', 'LLMG B Mizrah', 'TUBAS',
                        'GORAL', 'KENED']) {
      expect(codes.has(code)).toBe(false);
    }
  });
});
