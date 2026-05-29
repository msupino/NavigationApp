// @ts-check
// Regression coverage for the docs/nav-waypoints.json content
// (issues #406 and #408 — and now #410, the image-based rebuild).
//
// The dataset was originally rebuilt from the published IAA CVFR chart
// waypoint reference table (page 113, 2025 edition, shipped upstream as
// `113_waypoints.csv`). The legacy ForeFlight-derived JSON had ~91 stale
// codes (`AREA *`, `LLHA A/B/C`, `LLMG A/B Maarav/Mizrah`, etc.) and a
// handful of reporting points with chart-disagreeing coords — notably
// BEZRA (~752 m) and KUVSH (~648 m), the heading-drift culprits.
//
// PR #410 then rebuilt nav-waypoints.json a second time directly from a
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
const fs = require('fs');
const path = require('path');

const JSON_PATH = path.join(__dirname, '..', 'docs', 'nav-waypoints.json');

function loadData() {
  return JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
}

test.describe('#406 / #410 — nav-waypoints.json (chart-sourced)', () => {
  test('parses and exposes the expected entry count', async () => {
    const d = loadData();
    expect(Array.isArray(d.waypoints)).toBe(true);
    // 199 chart rows: 26 ARP (filtered out, see airfields.json) + 173
    // reporting points (89 mandatory + 84 on-request).
    expect(d.waypoints.length).toBe(173);
  });

  test('every entry carries name + he + lat + lng', async () => {
    const d = loadData();
    for (const w of d.waypoints) {
      expect(typeof w.name).toBe('string');
      expect(typeof w.he).toBe('string');
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
    // LLMZ is the one exception that the chart chose to ship as a
    // reporting point and not as an ARP, so it stays here.
    for (const code of ['LLBG', 'LLHZ', 'LLHA', 'LLER', 'LLES', 'LLEV',
                        'LLEY', 'LLFK', 'LLIB', 'LLKS', 'LLKZ', 'LLMG',
                        'LLRS', 'LLBS', 'LLEK', 'LLRM', 'LLRD', 'LLNV',
                        'LLOV', 'LLHS', 'LLHB', 'LLPL', 'LLBO']) {
      expect(codes.has(code)).toBe(false);
    }
  });

  test('BEZRA + KUVSH carry chart coords — heading-drift regression', async () => {
    const d = loadData();
    const bezra = d.waypoints.find(w => w.name === 'BEZRA');
    const kuvsh = d.waypoints.find(w => w.name === 'KUVSH');
    // Chart values (rounded to 5 dp). Pre-#406 nav-waypoints.json had
    // BEZRA at (31.73525, 34.64917) — ~752 m south of the chart — and
    // KUVSH at (31.26444, 34.76361) — ~648 m north of the chart. Both
    // shifts caused ~1° heading drift on cross-country legs that pass
    // through them.
    expect(bezra).toEqual({ name: 'BEZRA', he: 'בית עזרא',
                            lat: 31.74139, lng: 34.64583 });
    expect(kuvsh).toEqual({ name: 'KUVSH', he: 'כובשים',
                            lat: 31.25861, lng: 34.76361 });
  });

  // Spot checks that the image-based rebuild (#410) replaced the
  // CSV-derived text artefacts with what the chart actually prints.
  test('chart-correct Hebrew names (#410 — image-sourced)', async () => {
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
    expect(byCode.get('FRDIS').he).toBe('צומת פרדיס');
    // Spelling fixes vs the legacy CSV.
    expect(byCode.get('KRYON').he).toBe('קריון');
    expect(byCode.get('REVAH').he).toBe('רוחה');
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
    // surfaced these codes as missing from the ForeFlight-derived JSON.
    // The chart-sourced CSV carries them all.
    for (const code of ['NASIH', 'ZGOAL', 'LLMZ', 'MESEK', 'METAH',
                        'ZURIM', 'TZHOT', 'ZRANA', 'RANNO']) {
      expect(codes.has(code)).toBe(true);
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
