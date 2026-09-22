// @ts-check
// The toolbar speaks in sentence case.
//
// Every label in the Show* family reads "Show live traffic", "Show drift lines",
// "Show/pin airfields" -- the verb capitalised, nothing after it. Two labels were written in
// Title Case instead ("Show/Add Freq Changes", "Taxi and Takeoff (gal)"), which is the kind
// of thing nobody notices in isolation and everybody notices in a column.
//
// The test is a rule, not a list of two: any toolbar label that capitalises a later word
// fails, unless that word is an acronym or a proper noun. A label added in the wrong style
// is caught when it is added, which is the only time it is cheap to fix.
const { test, expect } = require('./_setup');

// Words that are capitalised because that is their spelling, not because of a style choice.
const PROPER = new Set(['NOTAM', 'NOTAMs', 'SIGWX', 'PWX', 'VOR', 'GPS', 'CVFR', 'VFR', 'IFR',
  'ATIS', 'METAR', 'TAF', 'ICAO', 'LSA', 'MSA', 'AIP', 'TMA', 'CTR', 'ATS', 'OSM', 'KML',
  'GPX', 'CSV', 'PDF', 'PNG', 'JSON', 'FPL', 'AIS', 'FDR', 'FMS', 'PLN', 'ADS-B', 'AIRMET',
  'AIRMETs', 'SIGMET', 'SIGMETs', 'X-Plane', 'Google', 'Earth', 'NavAid', 'Drive', 'Zulu',
  'Israel', 'Garmin', 'MSFS', 'Ctrl-F', 'Ctrl-Z', 'Wi-Fi', 'HTTP', 'HTTPS', 'URL', 'CORS',
  'Find', 'Offline', 'Alt', 'Low', 'Helicopters', 'Navigation', 'Satellite', 'OpenStreetMap']);

test('toolbar labels are sentence case', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => window.S && typeof S.tbShowVor === 'string');
  const odd = await page.evaluate((proper) => {
    const bad = [];
    for (const [key, value] of Object.entries(window.S)) {
      if (typeof value !== 'string') continue;
      if (!key.startsWith('tb') || key.endsWith('Title')) continue;
      // Labels only: a sentence is allowed its own capitals.
      if (value.length > 40 || /[.:!?]/.test(value)) continue;
      // Drop any leading symbol or emoji before reading the words.
      const text = value.replace(/^[^\p{L}]+/u, '');
      const words = text.match(/[\p{L}][\p{L}'/-]*/gu) || [];
      if (words.length < 2) continue;
      const later = words.slice(1).filter(w =>
        /^\p{Lu}/u.test(w) && w.toUpperCase() !== w && !proper.includes(w));
      if (later.length) bad.push(key + ': "' + value + '" (' + later.join(', ') + ')');
    }
    return bad;
  }, [...PROPER]);
  expect(odd, 'toolbar labels in Title Case').toEqual([]);
});
