// @ts-check
// The hazard counts in Charts and in Extra layers read the same feeds, at the same time, by
// the same rule. Reported: Charts said SIGMET (5) while Extra layers said Show SIGMET (3) at
// the same moment -- the re-poll moved one and not the other (hazard-repoll.spec.js). Here:
// the look-ahead slider moves SIGMET as it moves NOTAM and AIRMET, and a layer toggle counts
// what its layer draws.
const { test, expect } = require('./_setup');

const H = 3600;
const nowS = () => Math.floor(Date.now() / 1000);
const area = [[32.9, 35.5], [33.2, 35.5], [30.3, 34.5], [30.7, 34.4], [32.9, 35.5]];

async function boot(page, { sigmets = [], airmets = [] }) {
  await page.route('**/sigmet.json', r => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ generatedAt: null, sigmets }) }));
  await page.route('**/airmet.json', r => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ generatedAt: null, airmets }) }));
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof window.refreshHazardFeeds === 'function'
    && Array.isArray(window.sigmets) && Array.isArray(window.airmets));
  await page.evaluate(async () => { await loadSigmets(true); await loadAirmets(true); window.refreshHazardFeeds(); });
}
const counts = (page, ids) => page.evaluate(list => list.map(id =>
  (document.getElementById(id).textContent || '').replace(/\D/g, '') || '0'), ids);
const slide = (page, h) => page.evaluate(v => {
  const el = document.getElementById('lookahead-time');
  el.value = String(v);
  el.dispatchEvent(new Event('input'));
}, h);

test('the look-ahead slider drops an expiring SIGMET from both counts, as it does an AIRMET', async ({ page }) => {
  const t = nowS();
  await boot(page, {
    sigmets: [
      { id: 'S1', hazard: 'TS', validFrom: t - H, validTo: t + H, coords: area, raw: 'S1' },
      { id: 'S2', hazard: 'TS', validFrom: t - H, validTo: t + 10 * H, coords: area, raw: 'S2' },
    ],
  });
  await expect.poll(() => counts(page, ['sigmet-count', 'sigmet-layer-count'])).toEqual(['2', '2']);
  await slide(page, 3);               // past S1's end
  await expect.poll(() => counts(page, ['sigmet-count', 'sigmet-layer-count'])).toEqual(['1', '1']);
  expect(await page.evaluate(() => activeSigmets().map(s => s.id))).toEqual(['S2']);
  await slide(page, 0);
  await expect.poll(() => counts(page, ['sigmet-count', 'sigmet-layer-count'])).toEqual(['2', '2']);
});

test('a layer toggle counts what the layer draws: an AIRMET with no usable area is listed, not counted on the map', async ({ page }) => {
  const iso = s => new Date(s * 1000).toISOString();
  const t = nowS();
  await boot(page, {
    airmets: [
      { id: 'A1', hazard: 'MT OBSC', validFrom: iso(t - H), validTo: iso(t + 5 * H), coords: area, raw: 'A1' },
      // A feed typo put a corner in the Atlantic: no drawable area (metAreaLatLngs).
      { id: 'A2', hazard: 'IFR', validFrom: iso(t - H), validTo: iso(t + 5 * H),
        coords: [[32.9, 0.0356], [33.2, 0.0356], [30.3, 0.0345]], raw: 'A2' },
    ],
  });
  await expect.poll(() => counts(page, ['airmet-btn-count', 'airmet-count'])).toEqual(['2', '1']);
});
