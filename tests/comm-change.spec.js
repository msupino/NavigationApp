// @ts-check
// Issue #399 — CVFR comm-change rendering on top of the nav-waypoint overlay.
//
// As of PR #401 the shipped dataset (docs/data/cvfr-comm-change.json) is intentionally
// empty (`points: []`) — the schema + rendering + toolbar toggle merge as
// plumbing, but no points are listed until a chart-specific source surfaces
// (PAMAT chapter B-03 / IAA AIP supplement / printed CVFR chart). Earlier
// inferences from sector-boundary geometry were removed (`points: []`).
//
// These tests therefore split into two groups:
//
//   1. SHIPPED-FILE TESTS: assert the toolbar/checkbox/dom presence and the
//      graceful-empty behaviour against the real docs/data/cvfr-comm-change.json
//      (commChangeMap is {} — no rings, no badges).
//
//   2. FIXTURE-BACKED TESTS: stub the cvfr-comm-change.json fetch with a small
//      synthetic dataset (TYONA + SORES + BAZRA) so we still exercise the
//      load + ring-draw + inspector-badge code paths without depending on
//      real chart data. Uses Playwright's page.route to intercept the
//      `cvfr-comm-change.json?v=...` request before the app fetches it.
//
// The renderer exposes `window.__commChangeRingsDrawn` (a Set of names drawn
// this frame) so the tests can assert visibility without snapshotting overlay
// canvas pixels — see draw.js drawNavWaypoints.
const { test, expect } = require('./_setup');
const fs = require('fs');

// TYONA reporting point — coords lifted from docs/data/cvfr-nav-waypoints.json.
const TYONA = { lat: 32.0047, lng: 34.7272, name: 'TYONA' };

// Synthetic fixture matching docs/data/cvfr-comm-change.json's schema. Three entries
// cover every branch the renderer + inspector care about:
//   * TYONA  — from/to present (full badge incl. freq row)
//   * SORES  — from/to present (alternate entry still draws)
//   * BAZRA  — commChange:true with note but NO from/to (freq-row omitted)
const FIXTURE = {
  version: 1,
  source: 'test fixture',
  _definition: 'test fixture entries — not real chart data',
  points: [
    {
      name: 'TYONA',
      commChange: true,
      from: 'Tel-Aviv Control 121.40 / 124.30',
      to: 'Pluto West 118.40',
      note: 'test fixture entry',
      source: 'test fixture',
    },
    {
      name: 'SORES',
      commChange: true,
      from: 'Pluto West 118.40',
      to: 'Hagav North 128.35',
      note: 'test fixture entry (inferred)',
      source: 'test fixture',
    },
    {
      name: 'BAZRA',
      commChange: true,
      note: 'test fixture entry — frequencies intentionally omitted',
      source: 'test fixture',
    },
  ],
};

const KNOWN_FREQ_POINT_FREQ_FIELDS = [
  'primary', 'alternate', 'secondary', 'secondaryAlternate',
];

function knownFreqPointFrequencyText(row) {
  return KNOWN_FREQ_POINT_FREQ_FIELDS.map(field => row[field]).filter(Boolean).join(' / ') || 'TBD';
}

function expectedKnownFreqPointRow(point, catalog) {
  const ids = Array.isArray(point.callSigns) ? point.callSigns.filter(Boolean) : [];
  if (!ids.length) return `| ${point.name} | TBD | TBD |`;
  const callSigns = ids.map(id => {
    const row = catalog[id];
    return `${row.he} (\`${id}\`)`;
  }).join(', ');
  const frequencies = ids.map(id => knownFreqPointFrequencyText(catalog[id])).join('; ');
  return `| ${point.name} | ${callSigns} | ${frequencies} |`;
}

// Install a route handler for the cvfr-comm-change.json request. Matches the
// shipped URL pattern `cvfr-comm-change.json?v=...` regardless of query string.
// MUST be called before `boot(page)` (i.e. before any page.goto) so the
// stub is registered before the app's first fetch.
async function installCommChangeFixture(page, fixture = FIXTURE) {
  await stubGraph(page, { commChange: fixture.points, callSigns: fixture.callSigns });
}

async function boot(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__test_commchange_init') !== '1') {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        // Open every accordion section so the comm-change checkbox is in
        // the DOM as a styled control, not just a hidden node.
        for (const s of ['build', 'view', 'display', 'charts', 'export', 'print']) {
          localStorage.setItem('navaid.sec.' + s, '1');
        }
        localStorage.setItem('__test_commchange_init', '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined');
  // Pre-warm every async dataset so subsequent draws / inspector renders
  // can assert against fully-populated state.
  await page.evaluate(() => loadNavWaypoints());
  await page.waitForFunction(() => Array.isArray(window.navWP) && window.navWP.length > 0);
  await page.evaluate(() => loadCommChange());
  await page.waitForFunction(() => window.commChangeMap &&
    typeof window.commChangeMap === 'object');
  // Frame the map on TYONA so the nav-WP dot lands in the viewport at a
  // high-enough zoom for drawNavWaypoints to project it on-canvas.
  await page.evaluate(t => map.setView([t.lat, t.lng], 11), TYONA);
  await page.waitForTimeout(80);          // let scheduleDraw flush an RAF
  await page.evaluate(() => draw());
}

test.describe('comm-change schema + UI plumbing (shipped populated dataset)', () => {
  test('shipped docs/data/cvfr-comm-change.json parses and loads commChange points', async ({ page }) => {
    await boot(page);
    const map = await page.evaluate(() => window.commChangeMap);
    expect(map).toBeTruthy();
    expect(typeof map).toBe('object');
    const keys = Object.keys(map);
    expect(keys.length).toBeGreaterThan(0);
    // Every shipped entry is either a 5-letter reporting point or a 4-letter
    // airfield ICAO destination, and is flagged commChange.
    const allowedPointKeys = ['callSigns', 'commChange', 'name', 'note', 'routeHints', 'source'];
    for (const k of keys) {
      expect(k).toMatch(/^(?:[A-Z]{5}|LL[A-Z0-9]{2})$/);
      expect(map[k].commChange).toBe(true);
      expect(Object.keys(map[k]).sort().every(key => allowedPointKeys.includes(key))).toBe(true);
    }
    expect(map.TYONA).toBeTruthy();
    expect(map.TYONA.callSigns).toContain('PLUTO_WEST');
    expect(map.TYONA.callSigns).toContain('PALMACHIM');
    expect(map.AAKKO.callSigns).toEqual(['PLUTO_EAST', 'HAIFA']);
    expect(map.AFULA.callSigns).toEqual(['PLUTO_EAST', 'RAMAT_DAVID', 'MEGIDDO']);
    expect(map.ARRAD.callSigns).toEqual(['HAGAV_SOUTH', 'HAGAV_NORTH', 'NEGEV']);
    expect(map.AYLON.callSigns).toEqual(['BEN_GURION', 'TEL_NOF']);
    expect(map.BEREC.callSigns).toEqual(['RAMON', 'OVDA']);
    expect(map.BASAN.callSigns).toEqual(['KIRYAT_SHMONA', 'PLUTO_EAST']);
    expect(map.BOKER.callSigns).toEqual(['RAMON', 'HAGAV_SOUTH']);
    expect(map.DALIA.callSigns).toEqual(['RAMAT_DAVID', 'PLUTO_WEST']);
    expect(map.DAROM.callSigns).toEqual(['HAIFA', 'PLUTO_WEST']);
    expect(map.DEROR.callSigns).toEqual(['HERZLIYA', 'PLUTO_WEST']);
    expect(map.DESHE.callSigns).toEqual(['ROSH_PINA', 'PLUTO_EAST']);
    expect(map.DIMON.callSigns).toEqual(['NEGEV', 'HAGAV_SOUTH']);
    expect(map.GILAM.callSigns).toEqual(['HAIFA', 'PLUTO_EAST']);
    expect(map.GNYAM.callSigns).toEqual(['HERZLIYA', 'BEN_GURION']);
    expect(map.HAROV.callSigns).toEqual(['PLUTO_EAST', 'PIK']);
    expect(map.HASID.callSigns).toEqual(['PLUTO_EAST', 'PLUTO_WEST', 'RAMAT_DAVID', 'HAIFA']);
    expect(map.HATRU.callSigns).toEqual(['NEGEV']);
    expect(map.HULAT.callSigns).toEqual(['PLUTO_EAST', 'ROSH_PINA']);
    expect(map.HODYA.callSigns).toEqual(['HAGAV_NORTH', 'HATZOR']);
    expect(map.HOVAV.callSigns).toEqual(['NEGEV', 'HAGAV_NORTH', 'HAGAV_SOUTH']);
    expect(map.KNTRY.callSigns).toEqual(['HERZLIYA']);
    expect(map.KTORA.callSigns).toEqual(['HAGAV_SOUTH', 'RAMON']);
    expect(map.LIAAD.callSigns).toEqual(['PLUTO_WEST', 'HAGAV_NORTH']);
    expect(map.LLBS.callSigns).toEqual(['TEYMAN']);
    expect(map.LLMZ.callSigns).toEqual(['MASADA']);
    expect(map.MOVIL.callSigns).toEqual(['RAMAT_DAVID', 'PLUTO_EAST']);
    expect(map.NCITY.callSigns).toEqual(['HAGAV_NORTH', 'KEDEM']);
    expect(map.NMASD.callSigns).toEqual(['PALMACHIM', 'HAGAV_NORTH']);
    expect(map.NOAAM.callSigns).toEqual(['HAGAV_NORTH', 'TEL_NOF']);
    expect(map.NTAIM.callSigns).toEqual(['BEN_GURION', 'PALMACHIM', 'TEL_NOF']);
    expect(map.NSHRM.callSigns).toEqual(['BEN_GURION']);
    expect(map.OVDAT.callSigns).toEqual(['HAGAV_SOUTH']);
    expect(map.PARDS.callSigns).toEqual(['BEN_GURION', 'PLUTO_WEST']);
    expect(map.NIZAN.callSigns).toEqual(['RAMON', 'HAGAV_SOUTH']);
    expect(map.SAMAR.callSigns).toEqual(['OVDA']);
    expect(map.SFAIM.callSigns).toEqual(['PLUTO_WEST']);
    expect(map.SDROT.callSigns).toEqual(['HAGAV_NORTH', 'KEDEM']);
    expect(map.SHRUT.callSigns).toEqual(['RAMON', 'OVDA']);
    expect(map.SIGAL.callSigns).toEqual(['HAGAV_NORTH', 'HAGAV_SOUTH']);
    expect(map.SIZFN.callSigns).toEqual(['OVDA', 'HAGAV_SOUTH']);
    expect(map.SOKET.callSigns).toEqual(['NEGEV', 'HAGAV_NORTH']);
    expect(map.SORES.callSigns).toEqual(['PLUTO_EAST', 'TEL_NOF']);
    expect(map.SOVAL.callSigns).toEqual(['HAGAV_NORTH', 'KEDEM']);
    expect(map.RUHOT.callSigns).toEqual(['RAMON', 'HAGAV_SOUTH']);
    expect(map.YAPAL.callSigns).toEqual(['PLUTO_WEST', 'HAGAV_NORTH']);
    expect(map.ZMGID.callSigns).toEqual(['PLUTO_EAST', 'PLUTO_WEST', 'MEGIDDO']);
    expect(map.ZASHD.callSigns).toEqual(['PALMACHIM']);
    expect(map.ZDAFA.callSigns).toEqual(['HAGAV_NORTH', 'HATZOR']);
    expect(map.ZMGEN.callSigns).toEqual(['HAGAV_NORTH', 'KEDEM']);
    expect(map.ZUKIM.callSigns).toEqual(['PLUTO_EAST', 'HAGAV_SOUTH']);
    expect(map.ZURIM.callSigns).toEqual(['HAGAV_NORTH']);
    const catalog = await page.evaluate(() => window.commChangeCallSigns);
    expect(catalog.PLUTO_WEST.label).toBe('Pluto West');
    expect(catalog.PLUTO_WEST.primary).toBe('118.40');
    expect(catalog.PLUTO_WEST.secondary).toBe('119.15');
    expect(catalog.PLUTO_WEST.unit).toBe('יב"א 506');
    expect(catalog.BEN_GURION.he).toBe('בן גוריון');
    expect(catalog.BEN_GURION.primary).toBe('134.60');
    expect(catalog.BEN_GURION.clearance).toBe('121.55');
    expect(catalog.PALMACHIM.label).toBe('Palmachim');
    expect(catalog.PALMACHIM.primary).toBe('135.55');
    expect(catalog.PALMACHIM.secondary).toBe('118.25');
    expect(catalog.PALMACHIM.atis).toBe('126.10');
    expect(catalog.HAIFA.he).toBe('חיפה');
    expect(catalog.HAIFA.primary).toBe('133.00');
    expect(catalog.HAIFA.secondary).toBe('127.80');
    expect(catalog.KIRYAT_SHMONA.he).toBe('קריית שמונה');
    expect(catalog.KIRYAT_SHMONA.primary).toBe('126.90');
    expect(catalog.MEGIDDO.he).toBe('מגידו');
    expect(catalog.MEGIDDO.primary).toBe('124.40');
    expect(catalog.ROSH_PINA.he).toBe('ראש פינה');
    expect(catalog.ROSH_PINA.primary).toBe('118.45');
    expect(catalog.ROSH_PINA.secondary).toBe('119.65');
    expect(catalog.ROSH_PINA.atis).toBe('132.45');
    expect(catalog.PLUTO_EAST.he).toBe('פלוטו מזרח');
    expect(catalog.PLUTO_EAST.primary).toBe('123.85');
    expect(catalog.PIK.he).toBe('פיק');
    expect(catalog.PIK.primary).toBe('122.55');
    expect(catalog.RAMAT_DAVID.he).toBe('רמת דוד');
    expect(catalog.RAMAT_DAVID.primary).toBe('130.50');
    expect(catalog.RAMAT_DAVID.secondary).toBe('119.80');
    expect(catalog.HAGAV_NORTH.primary).toBe('128.35');
    expect(catalog.HAGAV_NORTH.secondary).toBe('129.25');
  });

  test('known frequency files use valid radio-frequency formatting', async ({ page }) => {
    await boot(page);
    const catalog = await page.evaluate(() => window.commChangeCallSigns);
    const map = await page.evaluate(() => window.commChangeMap);
    const badCatalog = [];
    const freqFields = [
      'primary', 'secondary', 'alternate', 'secondaryAlternate',
      'atis', 'atisDeparture', 'ground', 'groundWest', 'groundEast',
      'clearance', 'appPrimary', 'appSecondary', 'tmaPrimary', 'tmaSecondary',
    ];
    for (const [id, row] of Object.entries(catalog)) {
      for (const field of freqFields) {
        if (row[field] && !/^\d{3}\.\d{2,3}$/.test(row[field])) {
          badCatalog.push(`${id}.${field}=${row[field]}`);
        }
      }
    }
    expect(badCatalog).toEqual([]);

    for (const file of ['known-frequencies.md', 'known-freq-points.md']) {
      const text = fs.readFileSync(file, 'utf8');
      const tokens = text.match(/\b1\d{2}(?:\.\d+)?\b/g) || [];
      const bad = tokens.filter(t => !/^\d{3}\.\d{2,3}$/.test(t));
      expect(bad, file).toEqual([]);
    }

    const freqMd = fs.readFileSync('known-frequencies.md', 'utf8');
    const idsInSection = heading => {
      const start = freqMd.indexOf(`## ${heading}`);
      expect(start, heading).toBeGreaterThanOrEqual(0);
      const rest = freqMd.slice(start + heading.length + 3);
      const next = rest.search(/\n## /);
      const section = next >= 0 ? rest.slice(0, next) : rest;
      return (section.match(/^\| ([A-Z0-9_]+) \|/gm) || [])
        .map(line => line.split('|')[1].trim())
        .filter(id => id !== 'ID')
        .sort();
    };
    const used = Array.from(new Set(Object.values(map)
      .flatMap(row => Array.isArray(row.callSigns) ? row.callSigns : []))).sort();
    const unused = Object.keys(catalog).filter(id => !used.includes(id)).sort();
    expect(idsInSection('Used By Frequency Points')).toEqual(used);
    expect(idsInSection('Not Assigned To Frequency Points')).toEqual(unused);
  });

  test('every comm-change point has at least one frequency option', async ({ page }) => {
    await boot(page);
    const { map, catalog } = await page.evaluate(() => ({
      map: window.commChangeMap,
      catalog: window.commChangeCallSigns,
    }));
    const missingOptions = [];
    const missingFrequencies = [];
    for (const [name, point] of Object.entries(map)) {
      const ids = Array.isArray(point.callSigns) ? point.callSigns.filter(Boolean) : [];
      if (!ids.length) {
        missingOptions.push(name);
        continue;
      }
      const hasFrequency = ids.some(id => {
        const row = catalog[id];
        return row && ((typeof row.primary === 'string' && row.primary.trim()) ||
          (typeof row.freq === 'string' && row.freq.trim()));
      });
      if (!hasFrequency) missingFrequencies.push(name);
    }
    expect(missingOptions).toEqual([]);
    expect(missingFrequencies).toEqual([]);
  });

  test('known-freq-points.md mirrors every comm-change point row from JSON', async () => {
    const comm = require('./_layerData').commChange('cvfr');
    const md = fs.readFileSync('known-freq-points.md', 'utf8');
    const actual = md.split('\n').filter(line => /^\| (?:[A-Z]{5}|LL[A-Z0-9]{2}) \|/.test(line));
    const expected = comm.points.map(point => expectedKnownFreqPointRow(point, comm.callSigns));
    expect(actual).toEqual(expected);
  });

  test('route template comm-change call signs have route-context hints', async () => {
    const comm = require('./_layerData').commChange('cvfr');
    const templates = JSON.parse(fs.readFileSync('docs/data/route-templates.json', 'utf8'));
    const byName = new Map((comm.points || []).map(point => [point.name, point]));
    const missing = [];
    const invalidHints = [];
    const legacyHints = [];
    for (const point of comm.points || []) {
      const callSigns = Array.isArray(point.callSigns) ? point.callSigns : [];
      if (Object.prototype.hasOwnProperty.call(point, 'from') ||
          Object.prototype.hasOwnProperty.call(point, 'to')) {
        legacyHints.push(point.name);
      }
      for (const hint of point.routeHints || []) {
        if (!hint || typeof hint !== 'object') {
          invalidHints.push(`${point.name}.routeHints[]`);
          continue;
        }
        if (!callSigns.includes(hint.callSign)) {
          invalidHints.push(`${point.name}.routeHints.callSign=${hint.callSign}`);
        }
        for (const field of ['before', 'after']) {
          if (field in hint && (typeof hint[field] !== 'string' || !hint[field].trim())) {
            invalidHints.push(`${point.name}.routeHints.${field}=${hint[field]}`);
          }
        }
      }
    }
    for (const tpl of templates.templates || []) {
      for (const note of tpl.notes || []) {
        if (!note || !note.cc || !note.freqName) continue;
        const point = byName.get(note.cc);
        const callSigns = point && Array.isArray(point.callSigns) ? point.callSigns : [];
        const waypoints = Array.isArray(tpl.waypoints) ? tpl.waypoints : [];
        const index = waypoints.indexOf(note.cc);
        const before = index > 0 ? waypoints[index - 1] : undefined;
        const after = index >= 0 && index < waypoints.length - 1 ? waypoints[index + 1] : undefined;
        const hints = point && Array.isArray(point.routeHints) ? point.routeHints : [];
        const hasRouteHint = hints.some(h =>
          h && h.callSign === note.freqName &&
          (before === undefined ? !h.before : h.before === before) &&
          (after === undefined ? !h.after : h.after === after));
        if (!point || !callSigns.includes(note.freqName) ||
            index < 0 || !hasRouteHint) {
          missing.push(`${tpl.id}: ${note.cc} -> ${note.freqName}`);
        }
      }
    }
    expect(legacyHints).toEqual([]);
    expect(invalidHints).toEqual([]);
    expect(missing).toEqual([]);
  });

  test('populated dataset draws comm-change rings for in-view points', async ({ page }) => {
    await boot(page);   // boot() frames the map on TYONA
    await page.evaluate(() => { window.showCommChange = true; draw(); });
    const drawn = await page.evaluate(() =>
      Array.from(window.__commChangeRingsDrawn || []));
    expect(drawn).toContain('TYONA');
  });

  test('comm-change rings are omitted from the PNG export', async ({ page }) => {
    await boot(page);
    // Sanity: rings draw on-screen.
    const onScreen = await page.evaluate(() => {
      window.showCommChange = true; draw();
      return Array.from(window.__commChangeRingsDrawn || []);
    });
    expect(onScreen).toContain('TYONA');
    // During export (NavAid.exporting) no rings are drawn.
    const exported = await page.evaluate(() => {
      NavAid.exporting = true; draw();
      const out = Array.from(window.__commChangeRingsDrawn || []);
      NavAid.exporting = false; draw();
      return out;
    });
    expect(exported).toEqual([]);
  });

  test('map waypoint inspector lists comm-change call-sign options for DALIA', async ({ page }) => {
    await boot(page);
    const out = await page.evaluate(() => {
      window.showCommChange = true;
      const index = navWP.findIndex(w => w.name === 'DALIA');
      state.selected = { type: 'navwp', index };
      showInspector();
      const items = Array.from(document.querySelectorAll('#inspector .commchange-option'));
      return {
        title: document.querySelector('#insp-title').value,
        ids: items.map(el => el.dataset.callSign),
        text: items.map(el => el.textContent),
        hasAddButton: !!document.querySelector('#inspector .add-freq-change-btn'),
      };
    });
    expect(out.title).toContain('DALIA');
    expect(out.ids).toEqual(['RAMAT_DAVID', 'PLUTO_WEST']);
    expect(out.text[0]).toMatch(/Ramat David/);
    expect(out.text[0]).toMatch(/130\.50/);
    expect(out.text[1]).toMatch(/Pluto West/);
    expect(out.text[1]).toMatch(/118\.40/);
    expect(out.hasAddButton).toBe(false);
  });

  test('a waypoint whose name is not in the dataset shows no badge', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'NOPE_TOKEN' }];
      state.legs = [];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
      draw();
    });
    await expect(page.locator('#inspector .commchange-row')).toHaveCount(0);
  });

  test('toolbar exposes a "Show Comm Changes" checkbox in the View section', async ({ page }) => {
    await boot(page);
    const labelText = await page.locator(
      'label[data-i18n-title="tbShowCommChangeTitle"]').textContent();
    expect(labelText).toMatch(/Show\/Add Freq Changes/i);
    const cb = page.locator('#commchange-cb');
    await expect(cb).toBeChecked();
    const commBeforeSnap = await page.evaluate(() => {
      const comm = document.querySelector('label[data-i18n-title="tbShowCommChangeTitle"]');
      const snap = document.querySelector('label[data-i18n-title="tbForceSnapTitle"]');
      return !!(comm && snap &&
        (comm.compareDocumentPosition(snap) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    expect(commBeforeSnap).toBe(true);
  });

  test('legacy stored-off comm-change preference is ignored after key rename', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
        sessionStorage.clear();
        for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
          localStorage.setItem('navaid.sec.' + s, '1');
        localStorage.setItem('navaid.showCommChange', '0');
      } catch (e) {}
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof state !== 'undefined');
    await expect(page.locator('#commchange-cb')).toBeChecked();
    expect(await page.evaluate(() => window.showCommChange)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('navaid.showFreqChanges'))).toBeNull();
  });

  test('Hebrew locale uses the translated toggle label', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('navaid.lang', 'he'); } catch (e) {}
    });
    await page.goto('?lang=he');
    await page.waitForFunction(() => typeof state !== 'undefined');
    const labelText = await page.locator(
      'label[data-i18n-title="tbShowCommChangeTitle"]').textContent();
    expect(labelText).toMatch(/הצג\/הוסף שינויי תדר/);
  });
});

test.describe('comm-change rendering (fixture-backed)', () => {
  test('loadCommChange populates commChangeMap with the fixture entries', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const tyona = await page.evaluate(() => window.commChangeMap.TYONA);
    expect(tyona).toBeTruthy();
    expect(tyona.commChange).toBe(true);
    expect(typeof tyona.from).toBe('string');
    expect(typeof tyona.to).toBe('string');
  });

  test('drawNavWaypoints draws the comm-change ring at TYONA', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.evaluate(() => { window.showCommChange = true; draw(); });
    const drawn = await page.evaluate(() =>
      Array.from(window.__commChangeRingsDrawn || []));
    expect(drawn).toContain('TYONA');
  });

  test('toggling Show Comm Changes off hides the ring without disabling nav-WPs', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    // Re-assert the enabled state first, then verify the off path.
    await page.evaluate(() => {
      const cb = document.getElementById('commchange-cb');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => window.showCommChange === true);
    await page.evaluate(() => draw());
    // Sanity check before flipping back.
    let drawn = await page.evaluate(() =>
      Array.from(window.__commChangeRingsDrawn || []));
    expect(drawn).toContain('TYONA');
    // Flip the checkbox via its native onchange (mirrors the user path).
    await page.evaluate(() => {
      const cb = document.getElementById('commchange-cb');
      cb.checked = false;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // The onchange handler calls draw() synchronously after the load
    // (which is a resolved promise once commChangeMap is populated).
    await page.waitForFunction(() => window.showCommChange === false);
    await page.evaluate(() => draw());
    drawn = await page.evaluate(() =>
      Array.from(window.__commChangeRingsDrawn || []));
    expect(drawn).not.toContain('TYONA');
    // Nav-WPs themselves should still be enabled (the toggle only hides
    // the augment, not the underlying overlay).
    const navOn = await page.evaluate(() => window.showNavWP === true);
    expect(navOn).toBe(true);
    // Persistence: the toggle wrote '0' to the renamed storage key.
    const stored = await page.evaluate(() => localStorage.getItem('navaid.showFreqChanges'));
    expect(stored).toBe('0');
    const legacy = await page.evaluate(() => localStorage.getItem('navaid.showCommChange'));
    expect(legacy).toBeNull();
  });

  test('inspector grows a Comm change badge for a TYONA-named route waypoint', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    // Drop a route waypoint at TYONA's coords with the canonical name.
    // The wp lookup uses the stored `name`, so this exercises both the
    // auto-snap path (where a click near TYONA adopts the name) and the
    // search-build path (which also stores the canonical ICAO).
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      state.legs = [];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
      draw();
    }, TYONA);
    const row = page.locator('#inspector .commchange-row');
    await expect(row).toBeVisible();
    const labelText = await row.locator('.commchange-label').textContent();
    expect(labelText).toMatch(/Freq change/i);
    // The fixture entry has both from and to populated.
    const freqText = await row.locator('.commchange-freq').textContent();
    expect(freqText).toMatch(/Tel-Aviv Control/);
    expect(freqText).toMatch(/Pluto West/);
  });

  test('inspector hides comm-change badge/details when the layer is off', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.locator('#commchange-cb').uncheck();
    await page.waitForFunction(() => window.showCommChange === false);

    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      state.legs = [];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
      draw();
    }, TYONA);

    await expect(page.locator('#inspector .commchange-row')).toHaveCount(0);
    await expect(page.locator('#inspector')).not.toContainText(/Freq change point/i);
    await expect(page.locator('#inspector')).not.toContainText(/Pluto West/);
  });

  test('united inspector: a freq-change waypoint edits the linked callout (call sign + frequency)', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const out = await page.evaluate(t => {
      window.showCommChange = true;
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      state.legs = [];
      syncLegs();
      // Seed the callout note for this comm-change point, then select the WP.
      if (typeof seedCommChangeNotes === 'function') seedCommChangeNotes();
      const noteCount = state.notes.filter(n => n && n.cc).length;
      state.selected = { type: 'wp', index: 0 };
      showInspector();
      draw();
      const insp = document.getElementById('inspector');
      // A frequency input means the editor (not the read-only badge) rendered.
      const inputs = insp.querySelectorAll('.freq-input');
      const callSignEditors = insp.querySelectorAll('.commchange-name-row select, .commchange-name-row input');
      return { noteCount, hasFreqInput: inputs.length > 0,
               hasCallSignEditor: callSignEditors.length > 0,
               hasReadOnlyBadge: !!insp.querySelector('.commchange-row') };
    }, TYONA);
    expect(out.noteCount).toBeGreaterThan(0);   // a callout note was seeded
    expect(out.hasReadOnlyBadge).toBe(false);   // united inspector edits instead of duplicating badge
    expect(out.hasCallSignEditor).toBe(true);   // call-sign editor present
    expect(out.hasFreqInput).toBe(true);        // editable, not read-only
  });

  test('inspector badge resolves a Hebrew-labelled waypoint to its comm-change point', async ({ page }) => {
    // Regression: in Hebrew locale snapped waypoints store the `he` label as
    // wp.name, but commChangeMap is keyed by canonical English. The badge
    // lookup must canonicalise first, or it silently misses in Hebrew.
    await installCommChangeFixture(page);
    await boot(page);
    const shown = await page.evaluate(t => {
      const nav = window.navWP.find(w => w.name === t.name);
      if (!nav || !nav.he) return { skip: true };
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: nav.he }];  // Hebrew label
      state.legs = [];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
      draw();
      const row = document.querySelector('#inspector .commchange-row');
      return { skip: false, visible: !!row, he: nav.he };
    }, TYONA);
    if (shown.skip) { test.skip(true, 'TYONA has no he label in dataset'); return; }
    expect(shown.visible).toBe(true);
  });

  test('fixture entries with from/to still populate commChangeMap', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const sores = await page.evaluate(() => window.commChangeMap.SORES);
    expect(sores).toBeTruthy();
    expect(sores.commChange).toBe(true);
    expect(sores.to).toBe('Hagav North 128.35');
  });

  test('fixture entry without from/to renders badge + note, omits freq row', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    // BAZRA in the fixture is the "frequencies not confirmed" case — the
    // entry has commChange:true + note but no from/to, exercising the
    // optional freq-row branch in showInspector().
    const BAZRA = { lat: 32.21861111111112, lng: 34.8825, name: 'BAZRA' };
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      state.legs = [];
      syncLegs();
      state.selected = { type: 'wp', index: 0 };
      showInspector();
      draw();
    }, BAZRA);
    const row = page.locator('#inspector .commchange-row');
    await expect(row).toBeVisible();
    await expect(row.locator('.commchange-label')).toBeVisible();
    await expect(row.locator('.commchange-note')).toBeVisible();
    // No from/to → no .commchange-freq element rendered.
    await expect(row.locator('.commchange-freq')).toHaveCount(0);
  });

  test('comm-change rings draw with the nav-WP dot layer OFF (decoupled, #484)', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    // Turn the nav-WP dot layer off but keep comm-change on: the ring must
    // still draw (it no longer lives inside drawNavWaypoints' early-return).
    await page.evaluate(async () => {
      window.showNavWP = false;
      window.showCommChange = true;
      // navWP positions are still required — loaded by the comm toggle/boot.
      if (typeof loadNavWaypoints === 'function') await loadNavWaypoints();
      draw();
    });
    const drawn = await page.evaluate(() =>
      Array.from(window.__commChangeRingsDrawn || []));
    expect(await page.evaluate(() => window.showNavWP)).toBe(false);
    expect(drawn).toContain('TYONA');
  });

  test('ring grows to enclose a named route-waypoint disc so it stays visible (#488)', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.evaluate(() => { window.showCommChange = true; draw(); });
    // Bare ring radius with no route waypoint on the point.
    const bare = await page.evaluate(() => {
      state.waypoints = []; state.legs = []; syncLegs();
      draw();
      return window.__commChangeRingRadii.TYONA;
    });
    // Drop a route waypoint on TYONA with "show waypoint names" ON — the
    // label-enlarged yellow disc would otherwise cover the bare ring.
    const grown = await page.evaluate(t => {
      window.showWpNames = true;
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: t.name }];
      state.legs = []; syncLegs();
      draw();
      return {
        ring: window.__commChangeRingRadii.TYONA,
        disc: waypointGeom(0).r,
      };
    }, TYONA);
    // Ring must now exceed both its bare size and the occupying disc radius.
    expect(grown.ring).toBeGreaterThan(bare);
    expect(grown.ring).toBeGreaterThan(grown.disc);
  });

  test('nav-WP dots draw with comm-change OFF and no rings (decoupled, #484)', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.evaluate(() => {
      window.showNavWP = true;
      window.showCommChange = false;
      draw();
    });
    const drawn = await page.evaluate(() =>
      Array.from(window.__commChangeRingsDrawn || []));
    expect(drawn).toHaveLength(0);
    expect(await page.evaluate(() => window.showNavWP)).toBe(true);
  });

  test('renamed waypoint seeds freq-change note when at ICAO position (#682)', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);

    // Place a waypoint AT TYONA with a custom (non-ICAO) name.
    await page.evaluate(t => {
      state.waypoints = [{ lat: t.lat, lng: t.lng, name: 'MY_CUSTOM_NAME' }];
      state.notes = [];
      syncLegs();
    }, TYONA);

    // seedCommChangeNotes should seed a note even though wp.name !== 'TYONA'.
    const atTyona = await page.evaluate(() => {
      seedCommChangeNotes();
      return state.notes.some(n => n && n.cc === 'TYONA');
    });
    expect(atTyona).toBe(true);

    // Move the waypoint far away — note should be pruned (stale).
    await page.evaluate(() => {
      state.waypoints[0].lat += 5;
      state.waypoints[0].lng += 5;
      seedCommChangeNotes();
    });
    const awayNote = await page.evaluate(() =>
      state.notes.some(n => n && n.cc === 'TYONA'));
    expect(awayNote).toBe(false);

    // Move it back to TYONA's coordinates — note should re-seed.
    await page.evaluate(t => {
      state.waypoints[0].lat = t.lat;
      state.waypoints[0].lng = t.lng;
      seedCommChangeNotes();
    }, TYONA);
    const backNote = await page.evaluate(() =>
      state.notes.some(n => n && n.cc === 'TYONA'));
    expect(backNote).toBe(true);
  });
});
