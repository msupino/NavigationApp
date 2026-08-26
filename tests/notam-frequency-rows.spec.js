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
  const read = (r) => ({
    cls: r.className,
    label: (r.querySelector('label') || {}).textContent || '',
    val: (r.querySelector('input') || {}).value
      || ((r.querySelector('.val') || {}).textContent || ''),
    title: r.title || '',
  });
  return Array.from(document.querySelectorAll('#insp-body .row')).map(read);
}, icao);

test('Haifa gains the clearance row it has no AIP row for, ringed', async ({ page }) => {
  await boot(page, LIVE);
  const rows = await openField(page, 'LLHA');
  const row = rows.find(r => /clearance-row/.test(r.cls));
  expect(row).toBeTruthy();
  // One row, not two: the frequency to call, marked as not-the-published-one.
  expect(row.cls).toMatch(/freq-notam-changed/);
  expect(row.val).toBe('127.80');
  expect(row.title).toBe('NOTAM A0685/26 · not published in the AIP');
  // The dataset itself still says what the AIP says: nothing.
  const published = await page.evaluate(() =>
    airfields.find(a => a.name === 'LLHA').clearance);
  expect(published).toBeUndefined();
});

test('Herzliya keeps one row per service, each ringed, AIP value in the title', async ({ page }) => {
  await boot(page, LIVE);
  const rows = await openField(page, 'LLHZ');
  const clearance = rows.find(r => /clearance-row/.test(r.cls));
  expect(clearance.val).toBe('118.55');
  expect(clearance.cls).toMatch(/freq-notam-changed/);
  // 121.70 is what AD 2.18 publishes; it is not lost, it is what the row says it replaced.
  expect(clearance.title).toBe('NOTAM C1574/26 · AIP 121.70');
  const tower = rows.find(r => /primary-row/.test(r.cls));
  expect(tower.val).toBe('125.60');
  expect(tower.cls).toMatch(/freq-notam-changed/);
  expect(tower.title).toMatch(/^NOTAM C1574\/26 · AIP /);
  // Exactly one row per service -- no second opinion beside it.
  expect(rows.filter(r => /clearance-row/.test(r.cls)).length).toBe(1);
});

test('the ring leaves when the NOTAM does, with no file to edit', async ({ page }) => {
  await boot(page, []);
  const rows = await openField(page, 'LLHZ');
  const clearance = rows.find(r => /clearance-row/.test(r.cls));
  expect(clearance.val).toBe('121.70');            // back to the AIP value on its own
  expect(clearance.cls).not.toMatch(/freq-notam-changed/);
  expect(await openField(page, 'LLHA')).not.toContainEqual(
    expect.objectContaining({ cls: expect.stringMatching(/clearance-row/) }));
});

test('reset returns to the NOTAM frequency, not the superseded one', async ({ page }) => {
  await boot(page, LIVE);
  await openField(page, 'LLHZ');
  const after = await page.evaluate(async () => {
    const row = document.querySelector('#insp-body .clearance-row');
    const inp = row.querySelector('input');
    inp.value = '119.00';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    row.querySelector('.commchange-freq-reset').click();
    await new Promise(r => setTimeout(r, 50));
    return document.querySelector('#insp-body .clearance-row input').value;
  });
  expect(after).toBe('118.55');
});

test('the gist can withdraw it and the row returns to the AIP value', async ({ page }) => {
  await boot(page, LIVE);
  const seen = await page.evaluate(() => {
    setTune('featureNotamFreqRows', false);
    state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLHZ') };
    showInspector();
    const row = document.querySelector('#insp-body .clearance-row');
    return { val: row.querySelector('input').value, cls: row.className,
             pointer: !!document.querySelector('#insp-body .freq-notam-row') };
  });
  expect(seen.val).toBe('121.70');
  expect(seen.cls).not.toMatch(/freq-notam-changed/);
  expect(seen.pointer).toBe(true);                 // the badge is untouched by any of this
});

// The airfield panel is not where a pilot reads the frequency they are about to call. A
// waypoint's comm-change is, and it seeds itself from the airfield's call sign -- so Bnei
// Dror, Deror and the rest of the northern set offered 122.20 while C1574/26 had Herzliya
// on 125.60. One definition (commCallSignTemplateFreq) feeds them all.
test('a call sign on a NOTAM frequency offers the NOTAM frequency everywhere', async ({ page }) => {
  await boot(page, LIVE);
  const seen = await page.evaluate(() => ({
    template: commCallSignTemplateFreq('HERZLIYA'),
    published: commCallSignPublishedFreq('HERZLIYA'),
    effective: commCallSignEffectiveFreq('HERZLIYA'),
    icao: commCallSignIcao('HERZLIYA'),
    change: commCallSignFreqChange('HERZLIYA'),
  }));
  expect(seen.icao).toBe('LLHZ');
  expect(seen.change).toMatchObject({ service: 'tower', freq: '125.60', id: 'C1574/26' });
  expect(seen.template).toBe('125.60');
  expect(seen.effective).toBe('125.60');
  // The published one is still answerable, which is what the row's title shows.
  expect(seen.published).toBe('122.20');
});

test('with the NOTAM gone the call sign is back on its published frequency', async ({ page }) => {
  await boot(page, []);
  const seen = await page.evaluate(() => ({
    template: commCallSignTemplateFreq('HERZLIYA'),
    change: commCallSignFreqChange('HERZLIYA'),
  }));
  expect(seen.change).toBe(null);
  expect(seen.template).toBe('122.20');
});

test('a call sign with no NOTAM is untouched', async ({ page }) => {
  await boot(page, LIVE);
  const seen = await page.evaluate(() => ({
    template: commCallSignTemplateFreq('BEN_GURION'),
    published: commCallSignPublishedFreq('BEN_GURION'),
  }));
  expect(seen.template).toBe(seen.published);
});
