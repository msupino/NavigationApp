// @ts-check
// Regression coverage for the docs/airfields.json content (issue #412).
//
// This file was rebuilt from the published IAA CVFR chart waypoint
// reference table (page 113, 2025 edition, same screenshot that fed
// PR #411's nav-waypoints.json rebuild). The chart's 26 ARP rows are
// now the canonical airfield list, replacing the legacy 16-entry JSON
// that drifted from the chart in three places by 400–555 m (LLMG,
// LLKS, LLES — the chart-vs-JSON drift originally identified during
// the route-heading regressions of #406).
//
// Per-entry: every chart ARP keeps the ICAO `name` and the chart's
// Hebrew `he` / lat / lng (chart is authoritative on Hebrew + coords).
// Plates, runways, elevation, and English name carry over from the
// previous airfields.json wherever the ICAO matched; ARPs newly
// surfaced from the chart ship as bare `{name, he, lat, lng}` until
// their BYOP enrichment is added in follow-ups.
//
// These assertions live as a Playwright spec only to reuse the
// existing _setup.js plumbing; they are pure JSON checks with no
// browser interaction.

const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const JSON_PATH = path.join(__dirname, '..', 'docs', 'airfields.json');

function loadData() {
  return JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
}

test.describe('#412 — airfields.json (chart-sourced)', () => {
  test('parses and exposes the expected entry count', async () => {
    const d = loadData();
    expect(Array.isArray(d.airfields)).toBe(true);
    // 26 chart ARP rows — 1 dropped (second LLNV row, see Anomalies
    // in the PR body: chart prints LLNV twice for Nevatim+Negev).
    expect(d.airfields.length).toBe(25);
  });

  test('every entry carries name + he + lat + lng', async () => {
    const d = loadData();
    for (const a of d.airfields) {
      expect(typeof a.name).toBe('string');
      expect(typeof a.he).toBe('string');
      expect(typeof a.lat).toBe('number');
      expect(typeof a.lng).toBe('number');
      // Israel rough bounding box — same envelope used in
      // nav-waypoints-dataset.spec.js so chart sub-tables that drift
      // across the border (typo, column swap, sign flip) trip here.
      expect(a.lat).toBeGreaterThan(29);
      expect(a.lat).toBeLessThan(34);
      expect(a.lng).toBeGreaterThan(33);
      expect(a.lng).toBeLessThan(36.5);
    }
  });

  test('ICAO codes are unique', async () => {
    const d = loadData();
    const codes = d.airfields.map(a => a.name);
    const seen = new Set();
    const dupes = [];
    for (const c of codes) {
      if (seen.has(c)) dupes.push(c);
      seen.add(c);
    }
    expect(dupes).toEqual([]);
  });

  // Hebrew final-letter forms — same rule used in
  // nav-waypoints-dataset.spec.js (#408). Final forms ך, ם, ן, ף, ץ
  // belong at end-of-word; the non-final forms כ, מ, נ, פ, צ never do.
  test('every he field uses final-letter forms at end of word', async () => {
    const d = loadData();
    const nonFinalAtEow = /[כמנפצ](?![\u05D0-\u05EA\u05F0-\u05F2])/;
    const offenders = [];
    for (const a of d.airfields) {
      if (nonFinalAtEow.test(a.he)) {
        offenders.push({ name: a.name, he: a.he });
      }
    }
    expect(offenders).toEqual([]);
  });

  // Coord spot-check: every ARP that was present in the pre-#412
  // airfields.json must now carry the chart-published DMS, rounded to
  // 5 dp. Catches accidental re-introduction of the legacy coords
  // (the LLMG / LLKS / LLES 400–555 m drift) and verifies the chart
  // values transcribed for LLBG (zero drift), LLER (zero drift),
  // LLHA (~186 m drift), and LLOV (newly surfaced).
  test('chart-correct coords for LLBG, LLER, LLHA, LLOV', async () => {
    const d = loadData();
    const byCode = new Map(d.airfields.map(a => [a.name, a]));
    expect(byCode.get('LLBG')).toMatchObject({
      lat: 32.00944, lng: 34.88556,
    });
    expect(byCode.get('LLER')).toMatchObject({
      lat: 29.72722, lng: 35.01417,
    });
    expect(byCode.get('LLHA')).toMatchObject({
      lat: 32.80833, lng: 35.04278,
    });
    expect(byCode.get('LLOV')).toMatchObject({
      lat: 29.935, lng: 34.94083,
    });
  });

  // The 400–555 m drifts the chart-rebuild was driven by — once
  // landed they must not regress to the legacy coords.
  test('chart-correct coords for LLMG, LLKS, LLES (drift fixes)', async () => {
    const d = loadData();
    const byCode = new Map(d.airfields.map(a => [a.name, a]));
    // LLMG: legacy (32.597301, 35.228802) → chart (32.59722, 35.23472), Δ ≈ 555 m
    expect(byCode.get('LLMG')).toMatchObject({
      lat: 32.59722, lng: 35.23472,
    });
    // LLKS: legacy (33.216275, 35.59622) → chart (33.21167, 35.59639), Δ ≈ 513 m
    expect(byCode.get('LLKS')).toMatchObject({
      lat: 33.21167, lng: 35.59639,
    });
    // LLES: legacy (32.4408,  35.007702) → chart (32.44139, 35.00333), Δ ≈ 416 m
    expect(byCode.get('LLES')).toMatchObject({
      lat: 32.44139, lng: 35.00333,
    });
  });

  // The chart treats LLAR (Arad) as out of scope and LLMZ (Bar Yehuda
  // / Masada) as a reporting waypoint (חובה, not ARP), so neither
  // belongs in airfields.json. LLMZ is now in nav-waypoints.json via
  // PR #411 instead.
  test('LLAR and LLMZ are not present (chart drops them as ARPs)', async () => {
    const d = loadData();
    const codes = new Set(d.airfields.map(a => a.name));
    expect(codes.has('LLAR')).toBe(false);
    expect(codes.has('LLMZ')).toBe(false);
  });

  // The chart surfaces 11 ARPs that were missing from the legacy
  // airfields.json — IAF bases and small civil strips that ship
  // without BYOP plates yet. Listing them keeps the diff pinned.
  test('newly-surfaced chart ARPs are present', async () => {
    const d = loadData();
    const codes = new Set(d.airfields.map(a => a.name));
    for (const code of ['KKDEM', 'GVULT', 'LLRM', 'LLRD', 'LLEK',
                        'LLNV', 'LLOV', 'LLPL', 'LLHS', 'LLHB',
                        'LLBO']) {
      expect(codes.has(code)).toBe(true);
    }
  });

  // BYOP plates and the runway-chip UI in interact.js read these
  // fields directly. The chart-rebuild must NOT have stripped them
  // from any entry that previously carried them.
  test('existing BYOP enrichment is preserved', async () => {
    const d = loadData();
    const byCode = new Map(d.airfields.map(a => [a.name, a]));

    // BG is the densest plate set in the file — anchor the upper bound.
    expect(byCode.get('LLBG').plates.length).toBeGreaterThan(30);
    expect(byCode.get('LLBG').runways).toEqual(['08/26', '12/30', '03/21']);
    expect(byCode.get('LLBG').elev_ft).toBe(134);
    expect(byCode.get('LLBG').en).toBe('Tel Aviv / Ben Gurion');

    // Eilat-Ramon — the other heavily-charted aerodrome.
    expect(byCode.get('LLER').plates.length).toBeGreaterThan(15);
    expect(byCode.get('LLER').runways).toEqual(['01/19']);

    // Spot-check the rest of the previously-enriched entries.
    for (const code of ['LLBS', 'LLES', 'LLEV', 'LLEY', 'LLFK', 'LLHA',
                        'LLHZ', 'LLIB', 'LLKS', 'LLKZ', 'LLMG', 'LLRS']) {
      const a = byCode.get(code);
      expect(Array.isArray(a.plates)).toBe(true);
      expect(a.plates.length).toBeGreaterThan(0);
      expect(typeof a.elev_ft).toBe('number');
      expect(typeof a.en).toBe('string');
    }
  });

  // The 11 bare entries (chart-only ARPs without prior enrichment).
  // Carrying empty `plates`/`runways` or stub `en`/`elev_ft` would
  // be misleading — the UI hides plate sections and runway chips on
  // missing data. The validator (io.js) now treats these as optional.
  test('bare chart-only entries carry only {name, he, lat, lng}', async () => {
    const d = loadData();
    const byCode = new Map(d.airfields.map(a => [a.name, a]));
    const bare = ['KKDEM', 'GVULT', 'LLRM', 'LLRD', 'LLEK',
                  'LLNV', 'LLOV', 'LLPL', 'LLHS', 'LLHB',
                  'LLBO'];
    for (const code of bare) {
      const a = byCode.get(code);
      expect(Object.keys(a).sort()).toEqual(['he', 'lat', 'lng', 'name']);
    }
  });

  // The LLNV duplicate (Nevatim + Negev) — keep only Nevatim. The
  // chart literally prints the ICAO twice; the Negev row is most
  // likely a chart typo for a different ICAO. Flagging via this test
  // until the next chart revision settles it.
  test('LLNV resolves to Nevatim (Negev row dropped — chart anomaly)', async () => {
    const d = loadData();
    const llnvRows = d.airfields.filter(a => a.name === 'LLNV');
    expect(llnvRows.length).toBe(1);
    expect(llnvRows[0].he).toBe('נבטים');
    expect(llnvRows[0].lat).toBe(31.21333);
    expect(llnvRows[0].lng).toBe(35.01833);
  });

  // Cross-reference: every ARP in nav-waypoints.json's exclusion list
  // (the codes #411 deliberately filtered out as airfields) MUST be
  // present here. Anything missing means a chart ARP got dropped on
  // the airfields side too — the renderer would then lose its blue
  // triangle, and snap-priority logic in applyNavSnap() would fall
  // back to nav-WP snapping for that aerodrome.
  test('all chart ARP codes from #411 are present here', async () => {
    const d = loadData();
    const codes = new Set(d.airfields.map(a => a.name));
    // Matches the airfield list in tests/nav-waypoints-dataset.spec.js
    // (the "does NOT include airfield ARP codes" test).
    for (const code of ['LLBG', 'LLHZ', 'LLHA', 'LLER', 'LLES', 'LLEV',
                        'LLEY', 'LLFK', 'LLIB', 'LLKS', 'LLKZ', 'LLMG',
                        'LLRS', 'LLBS', 'LLEK', 'LLRM', 'LLRD', 'LLNV',
                        'LLOV', 'LLHS', 'LLHB', 'LLPL', 'LLBO']) {
      expect(codes.has(code)).toBe(true);
    }
  });
});
