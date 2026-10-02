// @ts-check
// SIGMET / AIRMET decoder: the raw ICAO text read into labelled plain-language rows, in the
// UI's language; and a warning with a usable area is pressed to frame it on the map.
const { test, expect } = require('./_setup');

const AIRMET = 'LLLL AIRMET 20 VALID 021626/021900 LLBD- LLLL TEL AVIV FIR MOD TURB OBS WI N3310 E03556 - N3310 E03527 - N3240 E03444 - N3310 E03556 FL040/240 NC=';
const SIGMET = 'LCCC SIGMET T05 VALID 021700/022100 LCLK- LCCC NICOSIA FIR EMBD TS OBS NE OF LINE N3450 E03000 - N3525 E03255 TOP FL360 MOV NE 20KT NC=';

for (const [lang, want] of [
  ['en', { phenomenon: 'Moderate turbulence', levels: 'FL040–FL240', change: 'no change', valid: '02 16:26Z → 02 19:00Z' }],
  ['he', { phenomenon: 'מערבולות בינוניות', levels: 'FL040–FL240', change: 'ללא שינוי' }],
]) test(`an AIRMET decodes into its fields (${lang})`, async ({ page }) => {
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => typeof decodeMetText === 'function');
  const rows = await page.evaluate((r) => Object.fromEntries(decodeMetText(r).rows.map(x => [x.key, x.value])), AIRMET);
  for (const [k, v] of Object.entries(want)) expect(rows[k], k).toBe(v);
});

test('a SIGMET decodes side-of-line, tops and movement', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof decodeMetText === 'function');
  const d = await page.evaluate((r) => decodeMetText(r), SIGMET);
  const rows = Object.fromEntries(d.rows.map(x => [x.key, x.value]));
  expect(d.kind + ' ' + d.number).toBe('SIGMET T05');
  expect(rows.phenomenon).toBe('Embedded thunderstorms');
  expect(rows.area).toBe('North-east of the line');
  expect(rows.levels).toBe('Tops FL360');
  expect(rows.movement).toBe('Moving north-east 20 kt');
});

test('pressing an AIRMET with an area frames it; one with a broken area is listed only', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showAirmetDecoded === 'function' && typeof metAreaLatLngs === 'function');
  const got = await page.evaluate((raw) => {
    const now = Date.now();
    const good = { id: 'g', hazard: 'TURB', raw, validFrom: new Date(now - 6e5).toISOString(), validTo: new Date(now + 6e5).toISOString(),
      coords: [[33.1667, 35.9333], [33.1667, 35.45], [32.6667, 34.7333]] };
    const bad = { ...good, id: 'b', coords: [[33.1667, 3.9333], [33.1667, 35.45], [33.1667, 34.7333]] };
    map.setView([31.5, 34.9], 7, { animate: false });
    showAirmetDecoded([good, bad]);
    const cards = [...document.querySelectorAll('.met-card')];
    const focusable = cards.map(c => !!c.querySelector('.met-card-go'));
    const z0 = map.getZoom();
    cards[0].querySelector('.met-card-go').click();
    return { focusable, z0, z1: map.getZoom(), open: !!document.querySelector('.met-card'),
      inView: map.getBounds().contains([33.0, 35.3]) };
  }, AIRMET);
  expect(got.focusable).toEqual([true, false]);
  expect(got.open).toBe(false);
  expect(got.z1).toBeGreaterThan(got.z0);
  expect(got.inView).toBe(true);
});

test('the original text is one press away on every card', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof showAirmetDecoded === 'function');
  const got = await page.evaluate((raw) => {
    const now = Date.now();
    showAirmetDecoded([{ id: 'x', hazard: 'TURB', raw, validFrom: new Date(now - 6e5).toISOString(),
      validTo: new Date(now + 6e5).toISOString(), coords: [] }]);
    const card = document.querySelector('.met-card');
    const btn = card.querySelector('.met-card-btn');
    const rawEl = card.querySelector('.met-card-raw');
    const before = rawEl.hidden;
    btn.click();
    return { label: btn.textContent, before, after: rawEl.hidden, expanded: btn.getAttribute('aria-expanded') };
  }, AIRMET);
  expect(got.label).toBe('הטקסט המקורי');
  expect(got.before).toBe(true);
  expect(got.after).toBe(false);
  expect(got.expanded).toBe('true');
});
