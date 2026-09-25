// @ts-check
// Magnetic variation: automatic from the World Magnetic Model (docs/app/wmm.js, offline) where
// the headings are, or the pilot's own number -- set in the menu under the default speed.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');
const WMM = require('../docs/app/wmm.js');

test('WMM2025 matches every one of NOAA\'s published test values', () => {
  // tests/fixtures/WMM2025_TestValues.txt is NOAA's own file, shipped with the coefficients.
  const rows = fs.readFileSync(path.join(__dirname, 'fixtures/WMM2025_TestValues.txt'), 'utf8')
    .split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => l.trim().split(/\s+/).map(Number));
  expect(rows.length).toBe(100);
  for (const [year, altKm, lat, lng, decl] of rows) {
    expect(Math.abs(WMM.declination(lat, lng, altKm, year) - decl)).toBeLessThan(0.01);
  }
});

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof magVarInfo === 'function' && typeof refreshMagVarControl === 'function'
    && window.NavAidWmm);
}

test('automatic follows the place: Israel is the charts\' 5E, Iceland about 10W', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const at = (lat, lng) => { map.setView([lat, lng], 9, { animate: false }); return magVarInfo(); };
    return { israel: at(32.1, 34.9), iceland: at(64.08, -20.75), toMag: toMagnetic(214) };
  });
  expect(r.israel.auto).toBe(true);
  expect(Math.round(r.israel.east)).toBe(5);
  expect(r.iceland.east).toBeLessThan(-9);
  expect(r.iceland.east).toBeGreaterThan(-12);
  expect(r.toMag).toBe(Math.round(214 - r.iceland.east) % 360);   // magnetic = true - east
});

test('a live position outranks the route, and the route outranks the map', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    map.setView([64.08, -20.75], 9, { animate: false });            // Iceland on screen
    const mapOnly = magVarInfo().from;
    state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.4, lng: 35.0, name: 'B' }];
    const route = magVarInfo();
    window.gpsLiveOn = true;
    gpsOwn = { lat: 64.1, lng: -21.9, hdg: 200, t: Date.now() };
    const aircraft = magVarInfo();
    window.gpsLiveOn = false;
    return { mapOnly, route, aircraft };
  });
  expect(r.mapOnly).toBe('map');
  expect(r.route.from).toBe('route');
  expect(Math.round(r.route.east)).toBe(5);
  expect(r.aircraft.from).toBe('aircraft');
  expect(r.aircraft.east).toBeLessThan(-9);
});

test('the menu row sits under the default speed; manual E/W sets the variation and is kept', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.view', '1'); } catch (e) {} });
  await boot(page);
  const order = await page.evaluate(() => {
    const speed = document.getElementById('default-speed').closest('label');
    const next = speed.nextElementSibling;
    // One row, like the speed: the mode, the number and E/W all in the same label.
    return next && next.querySelector('#magvar-mode') && next.querySelector('#magvar-deg') && next.querySelector('#magvar-ew') ? 'next' : 'elsewhere';
  });
  expect(order).toBe('next');
  // Automatic: the fields hold the model's value, read-only, and the line says where from.
  await page.evaluate(() => { map.setView([64.08, -20.75], 9, { animate: false }); refreshMagVarControl(); });
  const autoShown = await page.evaluate(() => ({ deg: document.getElementById('magvar-deg').value,
    ew: document.getElementById('magvar-ew').value, ro: document.getElementById('magvar-deg').readOnly,
    east: magVarInfo().east }));
  expect(autoShown.ro).toBe(true);
  expect(autoShown.ew).toBe('W');
  expect(Number(autoShown.deg)).toBeCloseTo(-autoShown.east, 1);
  expect(await page.locator('#magvar-deg').getAttribute('title')).toContain('map centre');
  // Switching to manual starts from that value.
  await page.evaluate(() => { const m = document.getElementById('magvar-mode'); m.value = 'manual'; m.dispatchEvent(new Event('change')); });
  expect(await page.evaluate(() => magVarInfo())).toMatchObject({ auto: false, east: autoShown.east });
  expect(await page.evaluate(() => document.getElementById('magvar-deg').readOnly)).toBe(false);
  await page.evaluate(() => {
    const mode = document.getElementById('magvar-mode');
    mode.value = 'manual'; mode.dispatchEvent(new Event('change'));
    const deg = document.getElementById('magvar-deg'), ew = document.getElementById('magvar-ew');
    ew.value = 'W'; deg.value = '12'; deg.dispatchEvent(new Event('change'));
  });
  const r = await page.evaluate(() => ({ info: magVarInfo(), stored: [localStorage.getItem('navaid.magVarAuto'),
    localStorage.getItem('navaid.magVarManual')], mag: toMagnetic(100), enabled: !document.getElementById('magvar-deg').disabled }));
  expect(r.info).toMatchObject({ auto: false, east: -12, mv: 12 });
  expect(r.stored).toEqual(['0', '12']);
  expect(r.mag).toBe(112);                                   // 12W: magnetic = true + 12
  expect(r.enabled).toBe(true);
  // The pilot's choice outranks the gist after a reload.
  await page.reload();
  await page.waitForFunction(() => typeof magVarInfo === 'function' && typeof refreshMagVarControl === 'function');
  expect(await page.evaluate(() => magVarInfo())).toMatchObject({ auto: false, east: -12 });
  expect(await page.locator('#magvar-mode').inputValue()).toBe('manual');
});

test('Hebrew labels the row and says where the value comes from', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => document.documentElement.lang === 'he' && typeof refreshMagVarControl === 'function');
  await page.evaluate(() => refreshMagVarControl());
  await expect(page.locator('[data-i18n="tbMagVarLabel"]')).toHaveText('נטייה מגנטית')   // variation; סטייה is deviation;
  expect(await page.locator('#magvar-deg').getAttribute('title')).toContain('במרכז המפה');
});

test('the dial\'s magnetic number follows the variation as the map moves', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => new Promise(done => {
    map.setView([32.1, 34.9], 9, { animate: false });
    const israel = document.getElementById('rotate-hdg').value;
    map.once('moveend', () => setTimeout(() => done({ israel, iceland: document.getElementById('rotate-hdg').value }), 0));
    map.setView([64.08, -20.75], 9, { animate: false });
  }));
  expect(r.israel).toBe('355');                               // north up, 5E
  expect(r.iceland).toBe('10');                               // north up, ~10W
});
