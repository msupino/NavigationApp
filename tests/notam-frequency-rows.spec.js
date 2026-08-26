// A frequency a NOTAM states outright, shown as its own dated row.
//
// The rule this sits under has not moved: NOTAM text is not substituted into the AIP rows,
// because a mis-parse puts a pilot on the wrong frequency. What changed is that two shapes
// the CAA writes the same way every time can be read exactly, and a pilot who has to open a
// NOTAM list to find the frequency they must call before taxi is being made to work for
// something the app already knows.
//
// So the grammar is narrow on purpose, and half of this file is about what must NOT parse.
const { test, expect } = require('./_setup');

const feed = (notams) => ({ generatedAt: new Date().toISOString(), source: 'test',
  fir: 'LLLL', notams });

const LIVE = [
  // Verbatim from the FIR feed on 2026-08-26 -- the two shapes this is fitted to.
  { id: 'A0685/26', icao: 'LLHA', type: 'CACS',
    text: 'NEW FREQ INSTL FOR CLEARANCE BFR TAXI (CPT) 127.800MHZ. DEP FLT SHALL CTC TWR ON '
      + 'CPT FREQ BFR STARTING UP ENGINE.',
    start: '2020-01-01T00:00:00Z', end: '2030-01-01T00:00:00Z', geom: null },
  { id: 'C1574/26', icao: 'LLHZ', type: 'CACF',
    text: 'TWR FREQ TEMPO CHG TO 125.600MHZ, CLEARANCE (CPT) FREQ CHG TO 118.550MHZ.',
    start: '2020-01-01T00:00:00Z', end: '2030-01-01T00:00:00Z', geom: null },
];

const NOTAM_RE = /notam-data\/notam\.json/;

async function boot(page, notams) {
  await page.route(NOTAM_RE, r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(feed(notams)) }));
  await page.addInitScript(() => {
    try {
      for (const sec of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + sec, '1');
    } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof airfieldFreqChanges === 'function'
    && window.notams !== null);
}

const changes = (page, icao) => page.evaluate(c => airfieldFreqChanges(c), icao);

test('the two shapes in the feed today are read exactly', async ({ page }) => {
  await boot(page, LIVE);
  // Haifa: a clearance frequency INSTALLED where the AIP publishes none.
  expect(await changes(page, 'LLHA')).toEqual([
    { service: 'clearance', freq: '127.80', id: 'A0685/26' },
  ]);
  // Herzliya: both services changed by one NOTAM.
  expect(await changes(page, 'LLHZ')).toEqual([
    { service: 'tower', freq: '125.60', id: 'C1574/26' },
    { service: 'clearance', freq: '118.55', id: 'C1574/26' },
  ]);
});

test('127.800MHZ is shown the way a chart writes it', async ({ page }) => {
  await boot(page, LIVE);
  const [c] = await changes(page, 'LLHA');
  expect(c.freq).toBe('127.80');
});

// The half that matters. Each of these mentions a frequency and a service, and none of them
// states a new one -- a parser that fired on any of them would put a pilot on a frequency
// that is unserviceable, or on someone else's.
const MUST_NOT_PARSE = [
  'TWR FREQ 122.10MHZ U/S.',
  'CTC TWR ON 122.100MHZ FOR TAXI INSTRUCTIONS.',
  'CLEARANCE FREQ 118.550MHZ NOT AVBL DUE MAINT.',
  'TWR FREQ CHG TO BE PUBLISHED AT A LATER DATE.',
  'AD CLSD TO ALL FLT INCLUDING HEL, DUE WIP.',
  'CRANE ERECTED WI LLHA CTR, FM GND UP TO 26M 89FT AGL, 29M 95FT AMSL.',
];

test('a NOTAM that mentions a frequency without stating a new one yields nothing', async ({ page }) => {
  await boot(page, MUST_NOT_PARSE.map((text, i) => ({
    id: 'X000' + i + '/26', icao: 'LLHA', type: 'TEST', text,
    start: '2020-01-01T00:00:00Z', end: '2030-01-01T00:00:00Z', geom: null })));
  expect(await changes(page, 'LLHA')).toEqual([]);
});

test('an unparsed frequency NOTAM still raises the pointer badge', async ({ page }) => {
  await boot(page, [{ id: 'X0001/26', icao: 'LLHA', type: 'TEST',
    text: 'TWR FREQ 122.10MHZ U/S.',
    start: '2020-01-01T00:00:00Z', end: '2030-01-01T00:00:00Z', geom: null }]);
  const seen = await page.evaluate(() => ({
    parsed: airfieldFreqChanges('LLHA').length,
    pointed: airfieldFreqNotams('LLHA').map(n => n.id),
  }));
  expect(seen.parsed).toBe(0);
  expect(seen.pointed).toEqual(['X0001/26']);
});

const openField = (page, icao) => page.evaluate((c) => {
  state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === c) };
  showInspector();
  return Array.from(document.querySelectorAll('#insp-body .row')).map(r => ({
    cls: r.className,
    label: (r.querySelector('label') || {}).textContent || '',
    val: (r.querySelector('.val') || r.querySelector('input') || {}).textContent
      || (r.querySelector('input') || {}).value || '',
  }));
}, icao);

test('Haifa gains a clearance row it has no AIP row for', async ({ page }) => {
  await boot(page, LIVE);
  const rows = await openField(page, 'LLHA');
  const notamRow = rows.find(r => /freq-notam-value-row/.test(r.cls));
  expect(notamRow).toBeTruthy();
  expect(notamRow.label).toBe('Clearance — NOTAM A0685/26');
  expect(notamRow.val).toBe('127.80 MHz');
  // The dataset itself still says what the AIP says: nothing.
  const published = await page.evaluate(() =>
    airfields.find(a => a.name === 'LLHA').clearance);
  expect(published).toBeUndefined();
});

test('the row leaves when the NOTAM does, with no file to edit', async ({ page }) => {
  await boot(page, []);
  const rows = await openField(page, 'LLHA');
  expect(rows.some(r => /freq-notam-value-row/.test(r.cls))).toBe(false);
});

test('the gist can withdraw the rows and the pointer badge remains', async ({ page }) => {
  await boot(page, LIVE);
  const rows = await page.evaluate(() => {
    setTune('featureNotamFreqRows', false);
    state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLHA') };
    showInspector();
    return {
      value: !!document.querySelector('#insp-body .freq-notam-value-row'),
      pointer: !!document.querySelector('#insp-body .freq-notam-row'),
    };
  });
  expect(rows.value).toBe(false);
  expect(rows.pointer).toBe(true);
});
