// @ts-check
// Asked for: a shortcut from the chart you are reading to the same chart on the map. Opening
// a plate in Charts and then hunting through Extra layers for the toggle that draws it --
// and, for an instrument sheet, for its name among twenty -- is a long way round from a
// chart that is already open.
const { test, expect } = require('./_setup');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64');

async function boot(page) {
  await page.route(/(ifr|cvfr|circuit|training|commfail|heli)-img\/.*\.png/, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof plateMapLayer === 'function' && !!window.airfields);
  await page.evaluate(() => loadPlateTitles());
}

const kindOf = (page, plate) => page.evaluate((f) => {
  const r = plateMapLayer(f);
  return r ? r.kind : null;
}, plate);

test('a plate knows which layer draws it', async ({ page }) => {
  await boot(page);
  // Instrument sheets say so themselves: the builder records the plate each was made from.
  expect(await kindOf(page, 'LLBG_APPROACH_ILS 08.pdf')).toBe('ifr');
  // The older families are recognised by what the CAA calls the sheet.
  expect(await kindOf(page, 'LLHZ_airport_Annex Yud Bet.pdf')).toBe('circuit-cb');
  expect(await kindOf(page, 'LLHZ_airport_Annex Zayin.pdf')).toBe('training-cb');
  expect(await kindOf(page, 'LLHZ_airport_Annex Gimel.pdf')).toBe('cvfr-cb');
  // "הצטרפות בתקלת קשר מנתיבי CVFR" mentions CVFR and is a comm-failure sheet: the rules are
  // asked in an order that gets that right.
  expect(await kindOf(page, 'LLHZ_airport_Annex Yud Gimel.pdf')).toBe('commfail-cb');
});

test('a sheet nothing draws offers nothing', async ({ page }) => {
  await boot(page);
  expect(await kindOf(page, 'LLHZ_airport_Chart.pdf')).toBeNull();        // text pages
  expect(await kindOf(page, 'LLHZ_airport_Annex Tet.pdf')).toBeNull();    // parking stands
});

test('the button is on the viewer for a sheet that can be drawn, and not for one that cannot',
  async ({ page }) => {
    await boot(page);
    for (const [plate, wanted] of [['LLBG_APPROACH_ILS 08.pdf', true],
                                   ['LLHZ_airport_Chart.pdf', false]]) {
      const has = await page.evaluate(async (f) => {
        document.querySelectorAll('.modal-back.plate-viewer').forEach(el => el.remove());
        showPlateViewer(f, f);
        await new Promise(r => setTimeout(r, 150));
        return !!document.getElementById('plate-place-on-map');
      }, plate);
      expect(has, plate).toBe(wanted);
    }
  });

test('pressing it draws that sheet and goes there', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    map.setView([31.0, 34.5], 8);
    showPlateViewer('LLHZ_airport_Annex Yud Bet.pdf', 'circuit');
    await new Promise(r => setTimeout(r, 150));
    document.getElementById('plate-place-on-map').click();
    await new Promise(r => setTimeout(r, 700));
    const drawn = [];
    map.eachLayer(l => { if (l && l._ovType) drawn.push(l._ovType); });
    const hz = airfields.find(a => a.name === 'LLHZ');
    return { drawn, viewerGone: !document.querySelector('.modal-back.plate-viewer'),
             checked: document.getElementById('circuit-cb').checked,
             filter: document.getElementById('plate-airfield').value,
             at: [map.getCenter().lat, map.getCenter().lng], field: [hz.lat, hz.lng] };
  });
  expect(out.drawn).toContain('circuit_overlay');
  expect(out.checked).toBe(true);
  expect(out.viewerGone).toBe(true);        // the chart you asked to see is behind the modal
  expect(out.filter).toBe('LLHZ');          // and the plate filter follows the field
  expect(out.at[0]).toBeCloseTo(out.field[0], 2);
  expect(out.at[1]).toBeCloseTo(out.field[1], 2);
});

test('an instrument sheet is picked in the layer, not just switched on', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async () => {
    showPlateViewer('LLBG_APPROACH_RNP 26.pdf', 'RNP 26');
    await new Promise(r => setTimeout(r, 150));
    document.getElementById('plate-place-on-map').click();
    await new Promise(r => setTimeout(r, 700));
    const drawn = [];
    map.eachLayer(l => { if (l && l._ovType === 'ifr_overlay') drawn.push(l._ovPng); });
    return { drawn, picker: document.getElementById('ifr-sheet').value };
  });
  expect(out.drawn).toHaveLength(1);
  expect(out.picker).toContain('LLBG|');
  expect(out.drawn[0]).toMatch(/RNP26/i);   // the sheet that was open, not the first in the list
});
