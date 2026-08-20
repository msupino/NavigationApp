// @ts-check
// The airport-charts menu used to label every plate from its file name ("airport Annex
// Alef") — our storage convention, not what the plate is called. A pilot looking for the
// radio-failure joining chart had to know it is Annex Daled at Rosh Pina and Annex Yud Gimel
// at Herzliya. The rows now carry the CAA's own designation, from docs/data/plate-titles.json
// (written by scripts/aip-plate-titles.mjs, which matches our PDFs to the CAA index by hash).
const { test, expect } = require('./_setup');

async function openCharts(page, lang) {
  await page.goto(`?lang=${lang}&nogist`);
  await page.waitForFunction(() => typeof showChartsModal === 'function');
  await page.evaluate(() => showChartsModal('LLIB'));
  await page.waitForSelector('.charts-airport[data-icao="LLIB"] .plate-row');
}

const rows = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.charts-airport[data-icao="LLIB"] .plate-row')].map(r => ({
    annex: (r.querySelector('.plate-annex') || {}).textContent || '',
    title: (r.querySelector('.plate-row-title') || {}).textContent || '',
    amd: (r.querySelector('.plate-row-amd') || {}).textContent || '',
  })));

test('a Hebrew session shows the CAA designation, not the file name', async ({ page }) => {
  await openCharts(page, 'he');
  const list = await rows(page);
  expect(list.length).toBeGreaterThan(5);
  const commfail = list.find(r => /תקלת קשר/.test(r.title));
  expect(commfail).toBeTruthy();
  expect(commfail.annex).toBe("ד'");            // the letter alone: every badge says נספח
  expect(commfail.title).toContain('הצטרפות');
  // The file name must not leak through for a plate the index knows.
  expect(list.every(r => !/airport|Annex [A-Z]/.test(r.title))).toBe(true);
});

test('the amendment the plate carries is on the row', async ({ page }) => {
  await openCharts(page, 'he');
  const list = await rows(page);
  const chart = list.find(r => r.annex === "א'");
  expect(chart).toBeTruthy();
  expect(chart.amd).toMatch(/^\d{1,2}\/\d{2}$/);   // 8/26, the way a plate writes it
});

// The domestic AIP is Hebrew-only, so an English session still gets the Hebrew designation —
// it is what the plate is called and what a controller will say.
test('an English session falls back to the Hebrew designation where there is no English', async ({ page }) => {
  await openCharts(page, 'en');
  const list = await rows(page);
  expect(list.find(r => /תקלת קשר/.test(r.title))).toBeTruthy();
});

// A plate the index does not know (one we ship that the CAA has since amended) still has to
// appear, labelled the old way rather than blank.
test('an unknown plate keeps its file-name label', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof plateDesignation === 'function');
  const out = await page.evaluate(async () => {
    await loadPlateTitles();
    return plateDesignation('LLXX_airport_Annex Zzz.pdf');
  });
  expect(out.title).toBe('airport Annex Zzz');
  expect(out.annex).toBe('');
});

// The designations come off the network and end up in a checked-in file, a workflow step
// summary and a button in the cockpit. CodeQL flagged that path, and it is right to: the
// script treats the index as text and nothing else.
test('the shipped designations carry no control, bidi or markdown characters', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof loadPlateTitles === 'function');
  const bad = await page.evaluate(async () => {
    const titles = await loadPlateTitles();
    const ctrl = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]');
    const markup = new RegExp('[`*_<>|\\\\]');
    const out = [];
    for (const [file, row] of Object.entries(titles)) {
      for (const key of ['annex', 'he', 'en']) {
        const v = row[key];
        if (typeof v !== 'string') { out.push(file + '.' + key + ' is not a string'); continue; }
        if (ctrl.test(v)) out.push(file + '.' + key + ' control/bidi');
        if (markup.test(v)) out.push(file + '.' + key + ' markup');
        if (v.length > 120) out.push(file + '.' + key + ' too long');
      }
      if (row.modified && !/^\d{4}-\d{2}-\d{2}$/.test(row.modified)) out.push(file + '.modified');
    }
    return out;
  });
  expect(bad).toEqual([]);
});
