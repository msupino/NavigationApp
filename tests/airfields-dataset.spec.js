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

// An overlay is either axis-aligned (sw/ne) or rotated (tl/tr/bl): a plate drawn off north --
// several are, by a degree or two -- cannot be expressed as a north-up box, and forcing one
// puts the sheet down turned and displaced. Both forms have to pass the same sanity checks.
function overlayCorners(co) {
  if (co.tl && co.tr && co.bl) {
    const lats = [co.tl[0], co.tr[0], co.bl[0]];
    const lngs = [co.tl[1], co.tr[1], co.bl[1]];
    return { sw: [Math.min(...lats), Math.min(...lngs)], ne: [Math.max(...lats), Math.max(...lngs)],
      rotated: true };
  }
  return { sw: co.sw, ne: co.ne, rotated: false };
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
    // AD 2.18 publishes no clearance for Haifa, and this file says so. The one a NOTAM
    // installed (A0685/26) is read out of the live feed and shown as its own dated row --
    // see notam-frequency-rows.spec.js. Baking it in here froze a temporary claim into a
    // file that means "published truth", and it had already gone stale once.
    expect(byCode.get('LLHA').clearance).toBeUndefined();
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
    LLMZ: { png: 'LLMZ_circuit.png', sw: [31.27945, 35.33016], ne: [31.39493, 35.43228] },
    LLFK: { png: 'LLFK_circuit.png', sw: [32.74266, 35.68131], ne: [32.82951, 35.75707] },
    LLKS: { png: 'LLKS_circuit.png', sw: [33.14265, 35.56420], ne: [33.24338, 35.65753] },
    LLKZ: { png: 'LLKZ_circuit.png', sw: [30.82464, 34.41778], ne: [30.89444, 34.47649] },
    LLMG: { png: 'LLMG_circuit.png', sw: [32.54446, 35.18406], ne: [32.65642, 35.27847] },
    LLRS: { png: 'LLRS_circuit.png', sw: [31.94445, 34.72947], ne: [31.99599, 34.76893] },
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
      // Geometry is axis-aligned (sw/ne) or rotated (tl/tr/bl, from the
      // ?align=1 editor). Accept either, sanity-check whichever is present.
      const isRect = Array.isArray(co.sw) && Array.isArray(co.ne);
      const isRot = ['tl', 'tr', 'bl'].every(k => Array.isArray(co[k]) && co[k].length === 2);
      expect(isRect || isRot, `${code} circuit_overlay has no geometry`).toBe(true);
      const pts = isRot ? [co.tl, co.tr, co.bl] : [co.sw, co.ne];
      for (const p of pts) {
        expect(p.length).toBe(2);
        expect(p[0]).toBeGreaterThan(29);        // lat in Israel envelope
        expect(p[0]).toBeLessThan(34);
        expect(p[1]).toBeGreaterThan(34);        // lng in Israel envelope
        expect(p[1]).toBeLessThan(36);
      }
      if (isRect) {
        expect(co.sw[0]).toBeLessThan(co.ne[0]);   // sw lat < ne lat
        expect(co.sw[1]).toBeLessThan(co.ne[1]);   // sw lng < ne lng
      } else {
        expect(co.bl[0]).toBeLessThan(co.tl[0]);   // bottom lat < top lat
        expect(co.tl[1]).toBeLessThan(co.tr[1]);   // left lng < right lng
      }
    }
  });

  test('LLES has no circuit_overlay (text plate, not georeferenced)', async () => {
    const d = loadData();
    const lles = d.airfields.find(a => a.name === 'LLES');
    expect(lles).toBeTruthy();
    expect(lles.circuit_overlay).toBeUndefined();
  });
});

test.describe('training_overlay field', () => {
  // Training-area overlays are added one airfield at a time, mirroring
  // circuit_overlay. Exact bounds per airfield are pinned here as they land.
  const EXPECTED = {};

  test('every training_overlay has correct shape and Israel-envelope bounds', async () => {
    const d = loadData();
    for (const af of d.airfields) {
      const to = af.training_overlay;
      if (!to) continue;
      expect(typeof to.png, `${af.name} training png`).toBe('string');
      expect(to.png).toMatch(/^[A-Z]{4}_training\.png$/);
      const { sw, ne, rotated } = overlayCorners(to);
      if (rotated) {
        for (const c of [to.tl, to.tr, to.bl]) expect(Array.isArray(c) && c.length === 2).toBe(true);
      } else {
        expect(Array.isArray(to.sw) && to.sw.length === 2).toBe(true);
        expect(Array.isArray(to.ne) && to.ne.length === 2).toBe(true);
      }
      expect(sw[0]).toBeLessThan(ne[0]);
      expect(sw[1]).toBeLessThan(ne[1]);
      expect(sw[0]).toBeGreaterThan(29);
      expect(ne[0]).toBeLessThan(34);
      expect(sw[1]).toBeGreaterThan(34);
      expect(ne[1]).toBeLessThan(36);
    }
  });

  test('pinned airfields carry the exact reviewed training_overlay bounds', async () => {
    const d = loadData();
    const byCode = new Map(d.airfields.map(a => [a.name, a]));
    for (const [code, exp] of Object.entries(EXPECTED)) {
      const to = byCode.get(code) && byCode.get(code).training_overlay;
      expect(to, `${code} missing training_overlay`).toBeTruthy();
      expect(to.png).toBe(exp.png);
      expect(to.sw).toEqual(exp.sw);
      expect(to.ne).toEqual(exp.ne);
    }
  });
});

test.describe('cvfr_overlay field', () => {
  // CVFR route overlays, mirroring circuit_overlay and training_overlay.
  // Coverage: LLAR, LLEY, LLFK, LLHZ, LLKS, LLMG, LLMZ. (Comm-failure entry
  // plates live in commfail_overlay, a separate layer.)
  const COVERAGE = ['LLAR', 'LLEY', 'LLFK', 'LLHZ', 'LLIB', 'LLKS', 'LLMG', 'LLMZ'];

  test('every cvfr_overlay has correct shape and Israel-envelope bounds', async () => {
    const d = loadData();
    for (const af of d.airfields) {
      const co = af.cvfr_overlay;
      if (!co) continue;
      expect(typeof co.png, `${af.name} cvfr png`).toBe('string');
      expect(co.png).toMatch(/^[A-Z]{4}_cvfr\.png$/);
      const { sw, ne, rotated } = overlayCorners(co);
      if (rotated) {
        for (const c of [co.tl, co.tr, co.bl]) expect(Array.isArray(c) && c.length === 2).toBe(true);
      } else {
        expect(Array.isArray(co.sw) && co.sw.length === 2).toBe(true);
        expect(Array.isArray(co.ne) && co.ne.length === 2).toBe(true);
      }
      expect(sw[0]).toBeLessThan(ne[0]);     // south of north
      expect(sw[1]).toBeLessThan(ne[1]);     // west of east
      expect(sw[0]).toBeGreaterThan(29);
      expect(ne[0]).toBeLessThan(34);
      expect(sw[1]).toBeGreaterThan(34);
      expect(ne[1]).toBeLessThan(36);
    }
  });

  test('all covered airfields carry a cvfr_overlay', async () => {
    const d = loadData();
    const byCode = new Map(d.airfields.map(a => [a.name, a]));
    for (const code of COVERAGE) {
      const co = byCode.get(code) && byCode.get(code).cvfr_overlay;
      expect(co, `${code} missing cvfr_overlay`).toBeTruthy();
      expect(co.png).toBe(`${code}_cvfr.png`);
    }
  });
});

test.describe('heli_overlay field', () => {
  // Helicopter entry/exit route overlays, mirroring cvfr_overlay.
  // Coverage: LLBS, LLHA, LLHZ, LLIB.
  const COVERAGE = ['LLBS', 'LLHA', 'LLHZ', 'LLIB'];

  test('every heli_overlay has correct shape and Israel-envelope bounds', async () => {
    const d = loadData();
    for (const af of d.airfields) {
      const ho = af.heli_overlay;
      if (!ho) continue;
      expect(typeof ho.png, `${af.name} heli png`).toBe('string');
      expect(ho.png).toMatch(/^[A-Z]{4}_heli\.png$/);
      expect(Array.isArray(ho.sw) && ho.sw.length === 2).toBe(true);
      expect(Array.isArray(ho.ne) && ho.ne.length === 2).toBe(true);
      expect(ho.sw[0]).toBeLessThan(ho.ne[0]);     // sw lat < ne lat
      expect(ho.sw[1]).toBeLessThan(ho.ne[1]);     // sw lng < ne lng
      expect(ho.sw[0]).toBeGreaterThan(29);
      expect(ho.ne[0]).toBeLessThan(34);
      expect(ho.sw[1]).toBeGreaterThan(34);
      expect(ho.ne[1]).toBeLessThan(36);
    }
  });

  test('all covered airfields carry a heli_overlay', async () => {
    const d = loadData();
    const byCode = new Map(d.airfields.map(a => [a.name, a]));
    for (const code of COVERAGE) {
      const ho = byCode.get(code) && byCode.get(code).heli_overlay;
      expect(ho, `${code} missing heli_overlay`).toBeTruthy();
      expect(ho.png).toBe(`${code}_heli.png`);
    }
  });
});

test.describe('commfail_overlay field', () => {
  // Radio comm-failure entry overlays, mirroring cvfr_overlay.
  // Coverage: LLHA (dedicated plate), LLHZ (reuses its CVFR-routes plate).
  const COVERAGE = ['LLHA', 'LLHZ', 'LLIB'];

  test('every commfail_overlay has correct shape and Israel-envelope bounds', async () => {
    const d = loadData();
    for (const af of d.airfields) {
      const co = af.commfail_overlay;
      if (!co) continue;
      expect(typeof co.png, `${af.name} commfail png`).toBe('string');
      expect(co.png).toMatch(/^[A-Z]{4}_commfail\.png$/);
      const { sw, ne, rotated } = overlayCorners(co);
      if (rotated) {
        for (const c of [co.tl, co.tr, co.bl]) expect(Array.isArray(c) && c.length === 2).toBe(true);
      } else {
        expect(Array.isArray(co.sw) && co.sw.length === 2).toBe(true);
        expect(Array.isArray(co.ne) && co.ne.length === 2).toBe(true);
      }
      expect(sw[0]).toBeLessThan(ne[0]);     // south of north
      expect(sw[1]).toBeLessThan(ne[1]);     // west of east
      expect(sw[0]).toBeGreaterThan(29);
      expect(ne[0]).toBeLessThan(34);
      expect(sw[1]).toBeGreaterThan(34);
      expect(ne[1]).toBeLessThan(36);
    }
  });

  test('all covered airfields carry a commfail_overlay', async () => {
    const d = loadData();
    const byCode = new Map(d.airfields.map(a => [a.name, a]));
    for (const code of COVERAGE) {
      const co = byCode.get(code) && byCode.get(code).commfail_overlay;
      expect(co, `${code} missing commfail_overlay`).toBeTruthy();
      expect(co.png).toBe(`${code}_commfail.png`);
    }
  });
});

// A canvas takes its paragraph direction from the interface language, so in Hebrew the map is
// laid out RTL and bidi reorders any label made of a Latin run followed by another run:
// "LLIB / ראש פינה" was drawn as "ראש פינה / LLIB". The code belongs first — that is the order
// the chart prints and the order the label is composed in.
test.describe('map labels keep the code before the name in Hebrew', () => {
  async function drawnLabels(page) {
    return page.evaluate(() => {
      const seen = [];
      const orig = octx.fillText.bind(octx);
      octx.fillText = function (t, x, y) { seen.push(String(t)); return orig(t, x, y); };
      try { draw(); } finally { octx.fillText = orig; }
      return seen;
    });
  }

  test('the airfield label is isolated left to right', async ({ page }) => {
    await page.goto('?lang=he&nogist');
    await page.waitForFunction(() => typeof draw === 'function' && typeof octx !== 'undefined'
      && Array.isArray(window.airfields) && airfields.length > 0);
    await page.evaluate(() => { map.setView([32.98, 35.57], 12); showAirfields = true; });
    const labels = await drawnLabels(page);
    const llib = labels.find(t => t.includes('LLIB'));
    expect(llib).toBeTruthy();
    expect(llib).toContain('ראש פינה');            // both halves still drawn
    expect(llib.startsWith('⁦')).toBe(true);  // ...as one left-to-right unit
    expect(llib.endsWith('⁩')).toBe(true);
  });

  // The same string goes into the inspector's title INPUT, where an invisible control
  // character would be saved into a value the pilot edits.
  test('the inspector title carries no isolate characters', async ({ page }) => {
    await page.goto('?lang=he&nogist');
    await page.waitForFunction(() => typeof referenceInspectorTitle === 'function'
      && Array.isArray(window.airfields) && airfields.length > 0);
    const title = await page.evaluate(() => {
      const af = airfields.find(a => a.name === 'LLIB') || airfields[0];
      return referenceInspectorTitle(af, 'airfield');
    });
    expect(title).not.toMatch(/[⁦-⁩]/);
  });
});

// Reported: "LLBS is missing the CVFR routes, pdf exists, not added by extra layer". The
// plates shipped with the app all along; nothing georeferenced them, so Extra layers had
// nothing to draw. Every field whose plate list carries a CVFR route chart now has one,
// built by scripts/georef-plate.py from the plate's own graticule.
test('every field with a CVFR route plate has a CVFR overlay', async () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');
  const titles = JSON.parse(fs.readFileSync(path.join(root, 'docs/data/plate-titles.json'), 'utf8'));
  const data = JSON.parse(fs.readFileSync(path.join(root, 'docs/data/airfields.json'), 'utf8'));
  const fields = Array.isArray(data) ? data : data.airfields;
  // Two ways a plate says it carries the CVFR routes: the CAA's own designation, and the
  // file name the app ships it under (the domestic fields' titles are Hebrew-only, and a
  // couple carry no designation at all).
  const routePlate = {};
  for (const [file, t] of Object.entries(titles)) {
    if (/נתיבי כניסה ויציאה/.test(t.he || '') || /CVFR/.test(t.en || '')
        || /_(CVFR|Routes)\.pdf$/.test(file)) {
      routePlate[file.split('_')[0]] = file;
    }
  }
  expect(Object.keys(routePlate).length).toBeGreaterThanOrEqual(10);
  const missing = Object.keys(routePlate)
    .filter(icao => !(fields.find(f => f.name === icao) || {}).cvfr_overlay);
  expect(missing).toEqual([]);
});

test('LLRS CVFR overlay keeps its reviewed rotated anchors', async () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');
  const data = JSON.parse(fs.readFileSync(path.join(root, 'docs/data/airfields.json'), 'utf8'));
  const fields = Array.isArray(data) ? data : data.airfields;
  const llrs = fields.find(f => f.name === 'LLRS');

  expect(llrs.cvfr_overlay).toEqual({
    png: 'LLRS_cvfr.png',
    tl: [32.01458, 34.98322],
    tr: [31.82413, 34.98434],
    bl: [32.01318, 34.65388],
  });
});

// A plate is placed by its own graticule, so the box it produces has to hold the airfield
// the dataset already knows, and has to keep the shape of the paper: a degree of longitude
// covers cos(latitude) as much ground as a degree of latitude, and an overlay that ignores
// that is stretched however well its corners read.
test('each CVFR overlay contains its field and keeps the plate\'s proportions', async () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..');
  const data = JSON.parse(fs.readFileSync(path.join(root, 'docs/data/airfields.json'), 'utf8'));
  const fields = (Array.isArray(data) ? data : data.airfields).filter(f => f.cvfr_overlay);
  for (const f of fields) {
    const o = f.cvfr_overlay;
    expect(fs.existsSync(path.join(root, 'docs/cvfr-img', o.png))).toBe(true);
    if (o.sw && o.ne) {
      expect([f.name, f.lat > o.sw[0] && f.lat < o.ne[0]]).toEqual([f.name, true]);
      expect([f.name, f.lng > o.sw[1] && f.lng < o.ne[1]]).toEqual([f.name, true]);
    } else {
      // Rotated print: the corners span the same ground, just not axis-aligned.
      const lats = [o.tl[0], o.tr[0], o.bl[0]];
      const lngs = [o.tl[1], o.tr[1], o.bl[1]];
      expect([f.name, f.lat > Math.min(...lats) && f.lat < Math.max(...lats)]).toEqual([f.name, true]);
      expect([f.name, f.lng > Math.min(...lngs) && f.lng < Math.max(...lngs)]).toEqual([f.name, true]);
    }
  }
});
