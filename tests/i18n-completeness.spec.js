// Every English string must have a Hebrew counterpart, or a Hebrew session shows
// English text. The dataset URLs are the deliberate exception: they are
// locale-independent (same files, Hebrew text inside) and the Hebrew file says so.
const { test, expect } = require('./_setup');

const URL_KEYS = ['routeGraphUrl', 'airfieldsUrl', 'routeTemplatesUrl', 'vorUrl'];

// Legitimately identical in Hebrew — do not "translate" these:
//   aviation acronyms pilots read in latin on the charts and the radio,
//   product names, and format-only strings whose output is symbols + numbers.
// Anything NOT on this list that has no Hebrew letters is a real gap.
const SAME_IN_BOTH = [
  'choosePointNotam', 'notamInspLabel',        // NOTAM
  'tbSigmet', 'sigmetReadout',                 // SIGMET
  'tbAirmet',                                  // AIRMET -- an ICAO product name, same word in Hebrew
  'atis', 'wxMetar', 'plateCategoryStar',      // ATIS / METAR / STAR
  // The density-altitude row names where its temperature came from. A METAR is called a
  // METAR in Hebrew too -- the observation type, not a word to translate.
  'daFromMetar',
  // Two numbers and a dash. Called with one argument by the sweep above it reads
  // "undefined – 1", which is an artefact of the probe, not English on screen.
  'airspaceLimits',
  'geModeApp', 'geModeWeb',                    // Google Earth Pro / Web
  'tbViewSource', 'tbWiki',                    // GitHub / Wiki
  'vorRadialDme', 'windFetchOk',               // "R-123° / 4 NM", "5 hPa ← .."
  'routeLibraryExportJson',                    // JSON, beside the GPX button
  'watchAlertTopTitle',                         // "NavAid — TOP" -- CVFR radio phraseology
  // The Hebrew ATIS alert is deliberately "ATIS <field> <freq>": ATIS is what the service is
  // called in Hebrew too, and the field name arrives as an argument (ראש פינה), not in the
  // template. A Hebrew word here would be an invention, not a translation.
  'watchAlertAtisTitle', 'watchAlertAtisBody', 'speakAlertAtis', 'atisMarkerLabel',
];

test('every English string key has a Hebrew one', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof S === 'object' && S.tbExport);
  const he = await page.evaluate(() => Object.keys(S));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof S === 'object' && S.tbExport);
  const en = await page.evaluate(() => Object.keys(S));
  // The Hebrew bundle merges over the English defaults, so both sessions expose
  // the same key set; the real check is that no English VALUE survives in Hebrew.
  expect(en.length).toBeGreaterThan(600);
  const missing = en.filter(k => !he.includes(k));
  expect(missing).toEqual([]);
});

test('no user-facing string is left in English in a Hebrew session', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof S === 'object' && S.tbExport);
  const untranslated = await page.evaluate(({ urlKeys, same }) => {
    const out = [];
    const hebrew = /[֐-׿]/;
    for (const [k, v] of Object.entries(S)) {
      if (urlKeys.includes(k) || same.includes(k)) continue;
      let text = v;
      if (typeof v === 'function') {
        try { text = v(1); } catch (e) { continue; }   // needs richer args; skip
      }
      if (typeof text !== 'string' || !text.trim()) continue;
      // Strings that are pure symbols, numbers, codes or latin-only product
      // names (GPX, VOR, A4) are legitimately identical in both languages.
      const letters = text.replace(/[^A-Za-z֐-׿]/g, '');
      if (letters.length < 4) continue;
      if (hebrew.test(text)) continue;
      out.push(k + ' = ' + text.slice(0, 60));
    }
    return out;
  }, { urlKeys: URL_KEYS, same: SAME_IN_BOTH });
  // Anything listed here renders as English to a Hebrew-speaking pilot.
  expect(untranslated).toEqual([]);
});

// The class of gap that "no Hebrew for 'No GPS track shown …'" turned out to be:
// six keys were referenced in code as `S.key || 'English literal'` but defined in
// NEITHER table, so both languages showed the English fallback. A key-to-key diff
// of the two tables cannot see those — only a scan of the source can.
test('every S.<key> referenced in code is defined, so no English fallback is reachable', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof S === 'object' && S.tbExport);
  // Read the list from index.html rather than repeating it. The hand-kept list had drifted
  // to 10 of the 16 scripts the app loads -- traffic.js, followme.js, density-altitude.js,
  // editor.js, alt-pair-directions.js and route-graph-shapes.js were never scanned, so an
  // English fallback added in any of them was invisible to this test.
  const undefinedKeys = await page.evaluate(async () => {
    const html = await (await fetch('index.html')).text();
    const files = [...new Set([...html.matchAll(/'(app\/[a-z0-9-]+\.js)'/g)].map(m => m[1]))];
    if (files.length < 12) return ['index.html: script list not found (' + files.length + ')'];
    const out = [];
    for (const f of files) {
      let text = '';
      try { text = await (await fetch(f)).text(); } catch (e) { continue; }
      // Only the `S.key || 'fallback'` form: a bare S.key may be an optional
      // string that the code deliberately treats as absent.
      for (const m of text.matchAll(/\bS\.([A-Za-z][A-Za-z0-9_]*)\s*\|\|\s*['\`"]/g)) {
        const k = m[1];
        if (S[k] === undefined && !out.includes(f + ': ' + k)) out.push(f + ': ' + k);
      }
    }
    return out;
  });
  expect(undefinedKeys).toEqual([]);
});

// The list above is only as good as its source. If index.html stops matching the pattern the
// scan reads, the previous test silently checks nothing -- which is how it came to cover 10
// files out of 16.
test('the scan covers every app script the page loads', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  const seen = await page.evaluate(async () => {
    const html = await (await fetch('index.html')).text();
    return [...new Set([...html.matchAll(/'(app\/[a-z0-9-]+\.js)'/g)].map(m => m[1]))];
  });
  const loaded = await page.evaluate(() =>
    [...document.querySelectorAll('script[src]')]
      .map(s => s.getAttribute('src').split('?')[0])
      .filter(s => s.startsWith('app/')));
  expect(loaded.length).toBeGreaterThan(0);
  expect([...loaded].sort()).toEqual([...seen].sort());
});
