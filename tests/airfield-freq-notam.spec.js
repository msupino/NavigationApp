// @ts-check
// A frequency NOTAM is surfaced as a POINTER, never as a value. The published frequency
// stays what the app shows; the badge says "there is a NOTAM about a frequency here".
//
// Not parsing the value is the point. A NOTAM frequency is true today, not in general, so
// baking one into airfields.json beside `clearance` would freeze a temporary claim into a
// file meaning "published truth" — how closedHint and openFromHourHint both went wrong.
// And a mis-parse puts a pilot on the wrong frequency, which is worse than making them
// read the NOTAM.
const { test, expect } = require('./_setup');

const RE = /notam-data\/notam\.json/;
const FAR = '2035-12-31T23:59:00Z';
const DATA = {
  generatedAt: '2026-08-11T09:00:00Z', fir: 'LLLL',
  notams: [
    { id: 'F1/26', icao: 'LLHZ', end: FAR, geom: null,
      text: 'F1/26 LLHZ E) TWR FREQ CHANGED TO 125.6 MHZ.' },
    { id: 'F2/26', icao: 'LLHZ', end: FAR, geom: null,
      text: 'F2/26 LLHZ E) CRANE ERECTED 1.2NM SW OF ARP.' },
    { id: 'F3/26', icao: 'LLBG', end: FAR, geom: null,
      text: 'F3/26 LLBG E) ATIS 130.2 OUT OF SERVICE.' },
  ],
};

async function boot(page) {
  await page.route(RE, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DATA) }));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof airfieldFreqNotams === 'function' && document.getElementById('notam-cb'));
  // The overlay toggle is what fetches the feed — same path the NOTAM specs use.
  await page.evaluate(() => { const cb = document.getElementById('notam-cb'); if (!cb.checked) cb.click(); });
  await page.waitForFunction(() => Array.isArray(notams) && notams.length > 0, null, { timeout: 15000 });
}

test('it points at frequency NOTAMs for that airfield only', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => ({
    hz: airfieldFreqNotams('LLHZ').map(n => n.id),
    bg: airfieldFreqNotams('LLBG').map(n => n.id),
    lower: airfieldFreqNotams('llhz').map(n => n.id),
    none: airfieldFreqNotams('LLER').map(n => n.id),
    blank: airfieldFreqNotams('').map(n => n.id),
  }));
  expect(out.hz).toEqual(['F1/26']);        // the crane NOTAM is not a frequency one
  expect(out.bg).toEqual(['F3/26']);        // ATIS counts; scoped to its own field
  expect(out.lower).toEqual(['F1/26']);     // ICAO match is case-insensitive
  expect(out.none).toEqual([]);
  expect(out.blank).toEqual([]);
});

test('the published frequency is never replaced by the NOTAM value', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const af = airfieldByIcao('LLHZ');
    return { published: af && af.clearance, hits: airfieldFreqNotams('LLHZ').length };
  });
  // A NOTAM says 125.6. The dataset still says what the chart says, untouched.
  expect(out.hits).toBe(1);
  expect(out.published).toContain('121.70');
  expect(out.published).not.toContain('125.6');
});
