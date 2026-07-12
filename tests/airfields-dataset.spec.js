// @ts-check
// Regression coverage for the docs/data/airfields.json content (issue #412).
//
// This file was rebuilt from the published IAA CVFR chart waypoint
// reference table (page 113, 2025 edition, same screenshot that fed
// PR #411's cvfr-nav-waypoints.json rebuild). The chart's 26 ARP rows are
// now the canonical airfield list, replacing the legacy 16-entry JSON
// that drifted from the chart in three places by 400–555 m (LLMG,
// LLKS, LLES — the chart-vs-JSON drift originally identified during
// the route-heading regressions of #406).
//
// Per-entry: every chart ARP keeps the ICAO `name`, the chart's Hebrew
// `he` / lat / lng (chart is authoritative on Hebrew + coords), and an
// English `en` label for search/display. Plates, runways, and elevation
// carry over from the previous airfields.json wherever the ICAO matched;
// elevations newly confirmed from Wikipedia are kept as `elev_ft`.
//
// These assertions live as a Playwright spec only to reuse the
// existing _setup.js plumbing; they are pure JSON checks with no
// browser interaction.

const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const JSON_PATH = path.join(__dirname, '..', 'docs', 'data', 'airfields.json');

function loadData() {
  return JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
}

test.describe('#412 — airfields.json (chart-sourced)', () => {
  test('parses and exposes the expected entry count', async () => {
    const d = loadData();
    expect(Array.isArray(d.airfields)).toBe(true);
    // 26 chart ARP rows — 1 dropped (second LLNV row, see Anomalies
    // in the PR body: chart prints LLNV twice for Nevatim+Negev); LLEV
    // (עין ורד / Ein Vered) is an active ARP on the chart and is kept (it
    // had been mis-dropped earlier as the closed Sde Dov — that is LLSD);
    // LLMZ (Bar Yehuda / Masada) added as an airfield (it carries BYOP
    // plates); LLAR (Arad) re-added — its מנחת ערד ARP still prints on the
    // CVFR map and it retains its BYOP plates.
    expect(d.airfields.length).toBe(27);
  });

  test('every entry carries name + he + en + lat + lng', async () => {
    const d = loadData();
    for (const a of d.airfields) {
      expect(typeof a.name).toBe('string');
      expect(a.name.trim()).not.toBe('');
      expect(typeof a.he).toBe('string');
      expect(a.he.trim()).not.toBe('');
      expect(typeof a.en).toBe('string');
      expect(a.en.trim()).not.toBe('');
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
      en: 'Haifa', lat: 32.80833, lng: 35.04278,
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
    // LLKS: AIP aerodrome chart (update 2/22, 19 May 2022) ARP 33°12'51"N
    // 035°35'39"E = 33.21417, 35.59417 supersedes the earlier CVFR-read
    // (33.21167, 35.59639) after the 2026 reopening, Δ ≈ 345 m.
    expect(byCode.get('LLKS')).toMatchObject({
      lat: 33.21417, lng: 35.59417,
    });
    // LLES: legacy (32.4408,  35.007702) → chart (32.44139, 35.00333), Δ ≈ 416 m
    expect(byCode.get('LLES')).toMatchObject({
      lat: 32.44139, lng: 35.00333,
    });
  });

  // LLAR (Arad) and LLMZ (Bar Yehuda / Masada) both live here: each is
  // an aerodrome carrying retained BYOP plates. The 2025 chart ARP table
  // omits LLAR, but its מנחת ערד symbol still prints on the CVFR map, so
  // it keeps its airfields.json entry + plates.
  test('LLAR and LLMZ are present (plate-carrying aerodromes)', async () => {
    const d = loadData();
    const codes = new Set(d.airfields.map(a => a.name));
    expect(codes.has('LLAR')).toBe(true);
    expect(codes.has('LLMZ')).toBe(true);
  });

  // LLAR keeps the BYOP plates retained through the AIP refresh.
  test('LLAR carries its retained BYOP plates', async () => {
    const d = loadData();
    const llar = d.airfields.find(a => a.name === 'LLAR');
    expect(llar.he).toBe('ערד');
    expect(llar.en).toBe('Arad');
    expect(Array.isArray(llar.plates)).toBe(true);
    expect(llar.plates.length).toBeGreaterThan(0);
  });

  test('LLBO carries Habonim labels and retained BYOP plates', async () => {
    const d = loadData();
    const llbo = d.airfields.find(a => a.name === 'LLBO');
    expect(llbo).toMatchObject({
      he: 'הבונים',
      en: 'Habonim',
    });
    expect(Array.isArray(llbo.plates)).toBe(true);
    expect(llbo.plates).toEqual(expect.arrayContaining([
      'LLBO_Ground_Diagram.pdf',
      'LLBO_airport_Chart.pdf',
    ]));
  });

  // The chart surfaces 11 ARPs that were missing from the legacy
  // airfields.json — IAF bases and small civil strips that ship
  // without BYOP plates yet. Listing them keeps the diff pinned.
  test('newly-surfaced chart ARPs are present with English labels', async () => {
    const d = loadData();
    const byCode = new Map(d.airfields.map(a => [a.name, a]));
    const expectedEnglish = {
      KKDEM: 'Kedem',
      GVULT: 'Gvulot',
      LLRM: 'Ramon',
      LLRD: 'Ramat David',
      LLEK: 'Tel Nof',
      LLNV: 'Nevatim',
      LLOV: 'Ovda',
      LLPL: 'Palmachim',
      LLHS: 'Hatzor',
      LLHB: 'Hatzerim',
      LLBO: 'Habonim',
    };
    for (const [code, en] of Object.entries(expectedEnglish)) {
      expect(byCode.get(code).en).toBe(en);
    }
  });

  test('Wikipedia-confirmed elevations are stored in feet', async () => {
    const d = loadData();
    const byCode = new Map(d.airfields.map(a => [a.name, a]));
    const expected = {
      LLEK: 194,
      LLHB: 722,
      LLHS: 148,
      LLNV: 1391,
      LLOV: 1493,
      LLPL: 33,
      LLRD: 184,
      LLRM: 2126,
      LLMZ: -1240,
    };
    for (const [code, elevFt] of Object.entries(expected)) {
      expect(byCode.get(code).elev_ft).toBe(elevFt);
    }
  });

  test('known ATIS and clearance frequencies are stored on matching airfields', async () => {
    const d = loadData();
    const byCode = new Map(d.airfields.map(a => [a.name, a]));

    expect(byCode.get('LLBG').atis).toBe('Arrival 132.50 MHz / Departure 132.80 MHz');
    expect(byCode.get('LLBG').clearance).toBe('121.55 MHz');
    expect(byCode.get('LLER').atis).toBe('132.55 MHz');
    expect(byCode.get('LLHA').atis).toBe('135.40 MHz');
    expect(byCode.get('LLHZ').clearance).toBe('121.70 MHz');
    expect(byCode.get('LLIB').atis).toBe('132.45 MHz');
    expect(byCode.get('LLPL').atis).toBe('126.10 MHz');

    const withAtis = d.airfields
      .filter(a => typeof a.atis === 'string' && a.atis.trim())
      .map(a => a.name)
      .sort();
    expect(withAtis).toEqual(['LLBG', 'LLER', 'LLHA', 'LLIB', 'LLPL']);

    const withClearance = d.airfields
      .filter(a => typeof a.clearance === 'string' && a.clearance.trim())
      .map(a => a.name)
      .sort();
    expect(withClearance).toEqual(['LLBG', 'LLHZ']);
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

    // Spot-check the rest of the previously-enriched entries. LLEV
    // (Sde Dov) was dropped as a closed aerodrome.
    for (const code of ['LLBS', 'LLES', 'LLEY', 'LLFK', 'LLHA',
                        'LLHZ', 'LLIB', 'LLKS', 'LLKZ', 'LLMG', 'LLRS']) {
      const a = byCode.get(code);
      expect(Array.isArray(a.plates)).toBe(true);
      expect(a.plates.length).toBeGreaterThan(0);
      expect(typeof a.elev_ft).toBe('number');
      expect(typeof a.en).toBe('string');
    }
  });

  // The bare entries (chart-only ARPs without prior enrichment or a
  // Wikipedia-confirmed elevation). They still carry English labels for
  // search/display, but omit optional `plates`/`runways`/`elev_ft`; the
  // UI hides plate sections and runway chips on missing data.
  test('bare chart-only entries carry only labels and coords', async () => {
    const d = loadData();
    const byCode = new Map(d.airfields.map(a => [a.name, a]));
    // LLBO (Habonim) now carries BYOP plates from the AIP rebuild, so it
    // is no longer a bare chart-only entry.
    const bare = ['KKDEM', 'GVULT'];
    for (const code of bare) {
      const a = byCode.get(code);
      expect(Object.keys(a).sort()).toEqual(['en', 'he', 'lat', 'lng', 'name']);
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

  // Cross-reference: every ARP in cvfr-nav-waypoints.json's exclusion list
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
    for (const code of ['LLBG', 'LLHZ', 'LLHA', 'LLER', 'LLES',
                        'LLEY', 'LLFK', 'LLIB', 'LLKS', 'LLKZ', 'LLMG',
                        'LLRS', 'LLBS', 'LLEK', 'LLRM', 'LLRD', 'LLNV',
                        'LLOV', 'LLHS', 'LLHB', 'LLPL', 'LLBO']) {
      expect(codes.has(code)).toBe(true);
    }
  });
});

test.describe('circuit_overlay field', () => {
  // Circuit overlays are added one airfield at a time after per-plate
  // georeferencing review. LLHZ (Annex Yud Bet — תרשים ההקפה) is the first.
  const EXPECTED = {
    LLHZ: { png: 'LLHZ_circuit.png', sw: [32.1549, 34.8063], ne: [32.2199, 34.8602] },
    LLHA: { png: 'LLHA_circuit.png', sw: [32.74073, 34.99698], ne: [32.87846, 35.10790] },
    LLIB: { png: 'LLIB_circuit.png', sw: [32.89244, 35.49843], ne: [33.09184, 35.65483] },
    LLBS: { png: 'LLBS_circuit.png', sw: [31.25435, 34.69456], ne: [31.33371, 34.75651] },
    LLAR: { png: 'LLAR_circuit.png', sw: [31.1673, 35.1555], ne: [31.2831, 35.2515] },
    LLBO: { png: 'LLBO_circuit.png', sw: [32.56587, 34.86486], ne: [32.74037, 35.00440] },
    LLEY: { png: 'LLEY_circuit.png', sw: [30.59235, 35.17279], ne: [30.65785, 35.21658] },
  };

  test('reviewed airfields carry circuit_overlay with correct shape', async () => {
    const d = loadData();
    const byCode = new Map(d.airfields.map(a => [a.name, a]));
    for (const [code, exp] of Object.entries(EXPECTED)) {
      const af = byCode.get(code);
      expect(af, `${code} missing from airfields`).toBeTruthy();
      const co = af.circuit_overlay;
      expect(co, `${code} missing circuit_overlay`).toBeTruthy();
      expect(co.png).toBe(exp.png);
      expect(Array.isArray(co.sw) && co.sw.length === 2).toBe(true);
      expect(Array.isArray(co.ne) && co.ne.length === 2).toBe(true);
      // Rough sanity: SW south of NE, SW west of NE, coords in Israel envelope
      expect(co.sw[0]).toBeLessThan(co.ne[0]);     // sw lat < ne lat
      expect(co.sw[1]).toBeLessThan(co.ne[1]);     // sw lng < ne lng
      expect(co.sw[0]).toBeGreaterThan(29);
      expect(co.ne[0]).toBeLessThan(34);
      expect(co.sw[1]).toBeGreaterThan(34);
      expect(co.ne[1]).toBeLessThan(36);
    }
  });

  test('LLES has no circuit_overlay (text plate, not georeferenced)', async () => {
    const d = loadData();
    const lles = d.airfields.find(a => a.name === 'LLES');
    expect(lles).toBeTruthy();
    expect(lles.circuit_overlay).toBeUndefined();
  });
});
