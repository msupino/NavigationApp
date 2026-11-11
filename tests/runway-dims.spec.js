// @ts-check
// Asked: "for each airfield, add its length in ft and (m) and width, info from the charts". Each
// runway's length and width as its AIP chart publishes them (section 9 of the field's pack, or
// AD 2.12), in the airfield panel: feet first, metres in brackets.
const { test, expect } = require('./_setup');

async function panel(page, icao, lang) {
  await page.goto('?lang=' + (lang || 'en') + '&nogist');
  await page.waitForFunction(() => typeof loadAirfields === 'function' && typeof showInspector === 'function');
  return page.evaluate(async (icao) => {
    await loadAirfields();
    state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === icao) };
    showInspector();
    return [...document.querySelectorAll('#insp-body .row')].map(r => [...r.children].map(c => c.textContent.trim()).join(' ').replace(/\u00a0/g, ' '));
  }, icao);
}

test('Haifa: one runway, in feet and (metres), length and width', async ({ page }) => {
  const rows = await panel(page, 'LLHA');
  expect(rows).toContain('Runway 15/33 4,324 ft (1,318 m) × 98 ft (30 m)');
});

test('Ben Gurion: every runway, each with its own size', async ({ page }) => {
  const rows = await panel(page, 'LLBG');
  expect(rows).toEqual(expect.arrayContaining([
    'Runway 08/26 13,327 ft (4,062 m) × 148 ft (45 m)',
    'Runway 12/30 10,210 ft (3,112 m) × 148 ft (45 m)',
    'Runway 03/21 9,094 ft (2,772 m) × 197 ft (60 m)',
  ]));
});

test('the feet match the ones the charts print', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof window.runwayDimsText === 'function');
  const r = await page.evaluate(() => [
    runwayDimsText({ lengthM: 1403, widthM: 21 }),   // LLBS: 4 603 ft, 69 ft
    runwayDimsText({ lengthM: 1600, widthM: 30 }),   // LLKZ: 5 249 ft, 98 ft
    runwayDimsText({ lengthM: 1487, widthM: 19 }),   // LLBO: 4 879 ft, 62 ft
  ].map(t => t.replace(/\u00a0/g, ' ')));
  expect(r).toEqual(['4,603 ft (1,403 m) × 69 ft (21 m)', '5,249 ft (1,600 m) × 98 ft (30 m)',
    '4,879 ft (1,487 m) × 62 ft (19 m)']);
});

test('every civil field with an AIP chart carries its runway sizes', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof loadAirfields === 'function');
  const missing = await page.evaluate(async () => {
    await loadAirfields();
    return airfields.filter(a => a.plates.length && !(a.runwayDims && a.runwayDims.length)).map(a => a.name);
  });
  expect(missing).toEqual([]);
});

test('Rosh Pina: the two directions differ, and the LSA block stays', async ({ page }) => {
  const rows = await panel(page, 'LLIB');
  expect(rows).toContain('Runway 15 3,625 ft (1,105 m) × 98 ft (30 m)');
  expect(rows).toContain('Runway 33 3,307 ft (1,008 m) × 98 ft (30 m)');
  expect(rows.some(r => /minimal lighting/.test(r))).toBe(true);
});

test('Hebrew: the row reads left to right inside the Hebrew panel', async ({ page }) => {
  const rows = await panel(page, 'LLHZ', 'he');
  expect(rows).toContain('מסלול 10/28 2,963 ft (903 m) × 59 ft (18 m)');
});
