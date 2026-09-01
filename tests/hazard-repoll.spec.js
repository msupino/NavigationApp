// @ts-check
// NOTAM, SIGMET and AIRMET were each fetched once at boot and never again, so a hazard
// issued or cancelled mid-session only showed after a manual reload. refreshHazardFeeds()
// re-fetches the feeds already in use and redraws, so a newly published hazard appears on
// the map, in the decoded lists and in the dim-never-hide counts on its own. We serve each
// feed from a mutable holder and trigger the re-poll deterministically (no 10-min wait).
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined'
    && typeof draw === 'function' && typeof octx !== 'undefined'
    && typeof window.refreshHazardFeeds === 'function');
}

const AIRMET = {
  id: '42559', hazard: 'MT OBSC',
  validFrom: '2020-01-01T00:00:00.000Z', validTo: '2099-01-01T00:00:00.000Z',
  coords: [[32.91667, 35.58333], [33.25, 35.58333], [30.3, 34.58333], [30.7, 34.43333], [32.91667, 35.58333]],
  raw: 'LLLL AIRMET 1 VALID 310300/310700 MT OBSC OBS WI ... =',
};
const SIGMET = {
  id: 'LC01', hazard: 'TS',
  validFrom: 1600000000, validTo: 4100000000,   // NOAA unix seconds: 2020 .. 2099
  coords: [[32.9, 35.5], [33.2, 35.5], [30.3, 34.5], [30.7, 34.4], [32.9, 35.5]],
  raw: 'LLLL SIGMET 1 VALID ... TS =',
};
const notam = id => ({ id, text: 'AREA CLSD', start: '2020-01-01T00:00:00Z', end: '2099-01-01T00:00:00Z' });

const airmetCount = page => page.evaluate(() => activeAirmets().length);
const sigmetCount = page => page.evaluate(() => activeSigmets().length);
const notamCount = page => page.evaluate(() => activeNotams().length);
const repoll = page => page.evaluate(() => window.refreshHazardFeeds());

test('a newly published AIRMET appears on the next re-poll', async ({ page }) => {
  const holder = { airmets: [] };
  await page.route('**/airmet.json', r =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ generatedAt: null, airmets: holder.airmets }) }));
  await boot(page);
  await page.evaluate(() => loadAirmets(true));
  expect(await airmetCount(page)).toBe(0);

  holder.airmets = [AIRMET];
  await repoll(page);
  await page.waitForFunction(() => activeAirmets().length === 1);
  expect(await airmetCount(page)).toBe(1);

  // ...and it actually draws (dotted outline) once the layer is on.
  const dashes = await page.evaluate(() => {
    window.showAirmet = true;
    map.setView([31.7, 35.0], 8);
    let d = 0; const os = octx.setLineDash;
    octx.setLineDash = function (x) { if (x && x.length && x[0] === 2) d++; return os.apply(this, [x]); };
    draw();
    octx.setLineDash = os;
    return d;
  });
  expect(dashes).toBeGreaterThan(0);
});

test('a newly published SIGMET appears on the next re-poll', async ({ page }) => {
  const holder = { sigmets: [] };
  await page.route('**/sigmet.json', r =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ generatedAt: null, sigmets: holder.sigmets }) }));
  await boot(page);
  await page.evaluate(() => loadSigmets(true));
  expect(await sigmetCount(page)).toBe(0);

  holder.sigmets = [SIGMET];
  await repoll(page);
  await page.waitForFunction(() => activeSigmets().length === 1);
  expect(await sigmetCount(page)).toBe(1);
});

test('a newly published NOTAM appears on the next re-poll', async ({ page }) => {
  const holder = { notams: [notam('A0001/26')] };
  await page.route('**/notam.json', r =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ generatedAt: null, notams: holder.notams }) }));
  await boot(page);
  await page.evaluate(() => loadNotam(true));
  expect(await notamCount(page)).toBe(1);

  holder.notams = [notam('A0001/26'), notam('A0002/26')];
  await repoll(page);
  await page.waitForFunction(() => activeNotams().length === 2);
  expect(await notamCount(page)).toBe(2);
});

test('a feed the pilot never used is not re-fetched by the poll', async ({ page }) => {
  // NOTAM is lazy — it loads only when the layer is first used. Until then notams===null and
  // the re-poll must not fetch it (no point spending requests on data nobody is showing).
  let notamHits = 0;
  await page.route('**/notam.json', r => { notamHits++; r.fulfill({ contentType: 'application/json', body: '{"notams":[]}' }); });
  await page.route('**/airmet.json', r => r.fulfill({ contentType: 'application/json', body: '{"airmets":[]}' }));
  await page.route('**/sigmet.json', r => r.fulfill({ contentType: 'application/json', body: '{"sigmets":[]}' }));
  await boot(page);
  await page.evaluate(() => { notams = null; });   // NOTAM layer never used -> feed unloaded
  const before = notamHits;
  await repoll(page);
  expect(notamHits).toBe(before);   // poll skipped the never-loaded NOTAM feed
});
