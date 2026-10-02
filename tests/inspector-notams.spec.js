// @ts-check
// A bubble the chart calls "open all day" while a NOTAM has closed it (reported: BKRML, under
// C1833/26 "ULTRALIGHT BUBBLE CLSD HAHULA (BHULA), KARMIEL (BKRML)"), and a leg through an
// area a NOTAM activated: the panel writes the NOTAMs in force out itself.
const { test, expect } = require('./_setup');

const NOW = Date.now();

async function lowAlt(page) {
  await page.goto('?lang=en&nogist&deck=0');
  await page.waitForFunction(() => typeof showInspector === 'function' && document.getElementById('layer-select'));
  await page.evaluate(() => {
    const s = document.getElementById('layer-select');
    s.value = 'Low Alt';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => layerDataPrefix() === 'lsa');
  await page.evaluate(async () => { areas = null; await loadAreas(); });
}

test('a bubble named in a NOTAM in force shows it; one that has ended does not', async ({ page }) => {
  await lowAlt(page);
  const got = await page.evaluate(([now]) => {
    notams = [
      { id: 'C1833/26', text: 'ULTRALIGHT BUBBLE CLSD HAHULA (BHULA), KARMIEL (BKRML).',
        start: new Date(now - 3600e3).toISOString(), end: new Date(now + 86400e3).toISOString(), geom: null },
      { id: 'C1000/26', text: 'ULTRALIGHT BUBBLE KARMIEL (BKRML) ACT.',
        start: new Date(now - 86400e3 * 3).toISOString(), end: new Date(now - 86400e3).toISOString(), geom: null },
    ];
    _notamBubbleGen++;
    state.selected = { type: 'lsaArea', index: areas.findIndex(a => a.icao === 'BKRML') };
    showInspector();
    return [...document.querySelectorAll('#insp-body .insp-notam-card .insp-notam-id')].map(e => e.textContent);
  }, [NOW]);
  expect(got).toEqual(['C1833/26']);
});

test('a leg through a NOTAM area shows it; a leg clear of it shows none', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showInspector === 'function' && typeof notamAffectsPlannedRoute === 'function');
  const got = await page.evaluate(([now]) => {
    state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.0, lng: 35.0, name: 'B' }, { lat: 32.4, lng: 35.0, name: 'C' }];
    syncLegs();
    notams = [{ id: 'B0001/26', text: 'UAV ACT', start: new Date(now - 3600e3).toISOString(),
      end: new Date(now + 3600e3).toISOString(), geom: { type: 'circle', lat: 32.0, lng: 34.9, radiusNm: 2 } }];
    const ids = (i) => { state.selected = { type: 'leg', index: i }; showInspector();
      return [...document.querySelectorAll('#insp-body .insp-notam-id')].map(e => e.textContent); };
    return { crossing: ids(0), clear: ids(1) };
  }, [NOW]);
  expect(got.crossing).toEqual(['B0001/26']);
  expect(got.clear).toEqual([]);
});
