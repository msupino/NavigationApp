// @ts-check
// Bubble-closure NOTAMs ("ULTRALIGHT BUBBLE CLSD HAHULA (BHULA)") carry no coordinates --
// the bubble code IS the geometry. On the LSA chart they resolve against the bubbles
// dataset and get a map presence like any other NOTAM. And the NOTAM list gets a
// freetext filter, because scanning ninety expanded texts by eye is not a filter.
const { test, expect } = require('./_setup');

const NOTAMS = { generatedAt: new Date().toISOString(), source: 'test', fir: 'LLLL', notams: [
  { id: 'C1584/26', icao: 'LLLL', type: 'AELC',
    text: 'ULTRALIGHT BUBBLE CLSD HAHULA (BHULA), KARMIEL (BKRML).',
    start: '2020-01-01T00:00:00Z', end: '2030-01-01T00:00:00Z', geom: null },
  { id: 'A0002/26', icao: 'LLBG', type: 'airspace', text: 'RWY 12/30 CLSD',
    start: '2020-01-01T00:00:00Z', end: '2030-01-01T00:00:00Z', geom: null },
  { id: 'A0003/26', icao: 'LLLL', type: 'airspace', text: 'PJE AREA ACTIVE MEGIDO',
    start: '2020-01-01T00:00:00Z', end: '2030-01-01T00:00:00Z',
    geom: { type: 'circle', lat: 32.6, lng: 35.2, radiusNm: 3 } },
] };
const NOTAM_RE = /notam-data\/notam\.json/;

async function boot(page) {
  await page.route(NOTAM_RE, r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(NOTAMS) }));
  await page.addInitScript(() => {
    try {
      for (const sec of ['build', 'view', 'display', 'charts'])
        localStorage.setItem('navaid.sec.' + sec, '1');
    } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof notamBubbleAreas === 'function' && window.notams !== null);
}

const toLsa = (page) => page.evaluate(async () => {
  const sel = document.getElementById('layer-select');
  sel.value = 'Low Alt';
  sel.onchange();
  await new Promise(r => setTimeout(r, 250));
  await loadAreas();
});

test('a bubble-closure NOTAM resolves to its bubbles and becomes mappable on LSA', async ({ page }) => {
  await boot(page);
  await toLsa(page);
  const r = await page.evaluate(() => {
    const n = notams.find(x => x.id === 'C1584/26');
    return {
      bubbles: notamBubbleAreas(n).map(a => a.icao).sort(),
      mappable: notamMappable(n),
      framePts: notamLatLngs(n).length,
      onLsa: activeNotams().some(x => x.id === 'C1584/26'),
    };
  });
  expect(r.bubbles).toEqual(['BHULA', 'BKRML']);
  expect(r.mappable).toBe(true);
  expect(r.framePts).toBeGreaterThan(5);
  expect(r.onLsa).toBe(true);
});

test('the same NOTAM stays off the CVFR chart, and off the map with no bubbles loaded', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const n = notams.find(x => x.id === 'C1584/26');
    return { onCvfr: activeNotams().some(x => x.id === 'C1584/26'),
      bubbles: notamBubbleAreas(n).length };
  });
  expect(r.onCvfr).toBe(false);   // ultralight NOTAMs are the LSA chart's business
  expect(r.bubbles).toBe(0);      // no bubbles dataset on cvfr -- nothing to resolve
});

test('the NOTAM list filters by freetext, over raw and decoded text alike', async ({ page }) => {
  await boot(page);
  await toLsa(page);
  await page.evaluate(() => showNotamModal());
  const items = page.locator('.notam-item');
  await expect(items).toHaveCount(3);
  const find = page.locator('.notam-find');
  await find.fill('KARMIEL');
  await expect(items).toHaveCount(1);
  await expect(page.locator('.notam-id')).toContainText('C1584/26');
  // Case-insensitive, and the count in the title follows the filter.
  await find.fill('megido');
  await expect(items).toHaveCount(1);
  await expect(page.locator('.notam-modal h3')).toContainText('— 1');
  await find.fill('');
  await expect(items).toHaveCount(3);
});
