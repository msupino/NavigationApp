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

test('clicking an AIRMET with an area turns the layer on and frames it; a broken area is listed only', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showAirmetDecoded === 'function' && typeof metAreaLatLngs === 'function');
  const got = await page.evaluate((raw) => {
    const now = Date.now();
    const good = { id: 'g', hazard: 'TURB', raw, validFrom: new Date(now - 6e5).toISOString(), validTo: new Date(now + 6e5).toISOString(),
      coords: [[33.1667, 35.9333], [33.1667, 35.45], [32.6667, 34.7333]] };
    const bad = { ...good, id: 'b', coords: [[33.1667, 3.9333], [33.1667, 35.45], [33.1667, 34.7333]] };
    window.setMetLayer('airmet', false);
    map.setView([31.5, 34.9], 7, { animate: false });
    showAirmetDecoded([good, bad]);
    const items = [...document.querySelectorAll('.met-item')];
    const clickable = items.map(c => c.classList.contains('notam-item-clickable'));
    const buttons = document.querySelectorAll('.met-item button').length;
    const z0 = map.getZoom();
    items[0].click();
    return { clickable, buttons, z0, z1: map.getZoom(), open: !!document.querySelector('.met-item'),
      layer: !!window.showAirmet, cb: document.getElementById('airmet-cb').checked,
      inView: map.getBounds().contains([33.0, 35.3]) };
  }, AIRMET);
  expect(got.clickable).toEqual([true, false]);
  expect(got.buttons).toBe(0);              // the card itself is the control, as a NOTAM's is
  expect(got.open).toBe(false);
  expect(got.layer).toBe(true);             // turned on, like a NOTAM picked from its list
  expect(got.cb).toBe(true);
  expect(got.z1).toBeGreaterThan(got.z0);
  expect(got.inView).toBe(true);
});

test('the list switches between decoded and original text, all at once, like the NOTAM list', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof showAirmetDecoded === 'function');
  const got = await page.evaluate((raw) => {
    const now = Date.now();
    showAirmetDecoded([{ id: 'x', hazard: 'TURB', raw, validFrom: new Date(now - 6e5).toISOString(),
      validTo: new Date(now + 6e5).toISOString(), coords: [] }]);
    const btn = document.querySelector('.met-modal .notam-raw-toggle');
    const item = document.querySelector('.met-item');
    const view = () => [item.querySelector('.met-raw').hidden, item.querySelector('.met-decoded').hidden];
    const label0 = btn.textContent, before = view();
    btn.click();
    const label1 = btn.textContent, after = view();
    return { label0, label1, before, after };
  }, AIRMET);
  expect(got.label0).toBe('הטקסט המקורי');
  expect(got.before).toEqual([true, false]);
  expect(got.after).toEqual([false, true]);
  expect(got.label1).toBe('מפוענח');
});

test('a SIGMET with a drawable area is drawn when its layer is on; the Ankara one counts', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof drawSigmets === 'function' && typeof setMetLayer === 'function');
  const got = await page.evaluate(() => {
    const now = Date.now() / 1000;
    window.sigmets = sigmets = [
      { id: '8', firId: 'LTAA', hazard: 'TS', qualifier: 'EMBD', validFrom: now - 600, validTo: now + 3600,
        coords: [[39, 34], [39, 38], [39, 41], [35.819, 41], [35.819, 34], [39, 34]], raw: 'LTAA SIGMET 8' },
      { id: 'L', firId: 'LLLL', hazard: 'TURB', validFrom: now - 600, validTo: now + 3600, coords: [], raw: 'LLLL SIGMET 1' }];
    let drawn = 0;
    const orig = octx.stroke.bind(octx);
    const count = () => { drawn = 0; octx.stroke = (...a) => { drawn++; return orig(...a); }; draw(); octx.stroke = orig; return drawn; };
    setMetLayer('sigmet', false);
    const off = count();
    setMetLayer('sigmet', true);
    const on = count();
    return { drawable: sigmets.map(s => !!metAreaLatLngs(s)), more: on > off };
  });
  expect(got.drawable).toEqual([true, false]);
  expect(got.more).toBe(true);
});

test('tapping an AIRMET area opens that AIRMET, with its own validity, read as a forecast', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof airmetsAtLatLng === 'function' && typeof showAirmetDecoded === 'function');
  const got = await page.evaluate(() => {
    const now = Date.now();
    const raw = 'LLLL AIRMET 23 VALID 021900/022300 LLBD- LLLL TEL AVIV FIR MT OBSC FCST WI N3241 E03514 - N3311 E03512 - N3321 E03548 - N3257 E03555 - N3243 E03541 - N3238 E03528 - N3241 E03514 STNR INTSF=';
    window.airmets = airmets = [{ id: '43078', hazard: 'MT OBSC', raw, validFrom: new Date(now - 6e5).toISOString(), validTo: new Date(now + 6e5).toISOString(),
      coords: [[32.6833, 35.2333], [33.1833, 35.2], [33.35, 35.8], [32.95, 35.9167], [32.7167, 35.6833], [32.6333, 35.4667], [32.6833, 35.2333]] }];
    window.showAirmet = true;
    map.setView([33.0, 35.5], 9, { animate: false });
    const ll = L.latLng(33.0, 35.5);
    map.fire('click', { latlng: ll, containerPoint: map.latLngToContainerPoint(ll), layerPoint: map.latLngToLayerPoint(ll), originalEvent: new MouseEvent('click') });
    const card = document.querySelector('.met-item');
    const rows = card ? Object.fromEntries([...card.querySelectorAll('.met-k')].map(k => [k.textContent, k.nextElementSibling.textContent])) : null;
    return { head: card && card.querySelector('.notam-id').textContent, rows };
  });
  expect(got.head).toContain('AIRMET #23');
  expect(got.rows.Valid).toBe('02 19:00Z → 02 23:00Z');
  expect(got.rows.Status).toBe('forecast');
  expect(got.rows.Change).toBe('intensifying');
});
