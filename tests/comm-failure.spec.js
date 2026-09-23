// @ts-check
// The comm-failure button: nearest field with a published comm-failure procedure, a route to
// its entry point at the published altitude, the chart on the map, and a card with 7600 and
// the tower's phone.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/data/commfail.json'), 'utf8'));
const GRAPH = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/data/cvfr-route-graph.json'), 'utf8'));
const AIRFIELDS = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/data/airfields.json'), 'utf8')).airfields;

// Location is switched on by the button. By default the browser refuses it, so these start
// from the map centre; `fix` hands the watch a position instead, `hold` keeps it waiting.
async function boot(page, lang = 'en', geo = 'deny') {
  await page.addInitScript((mode) => {
    window.__geoStarts = 0;
    navigator.geolocation.watchPosition = (ok, err) => {
      window.__geoStarts++;
      window.__geoOk = ok;
      if (mode === 'deny') setTimeout(() => err({ code: 1, message: 'denied' }), 0);
      if (mode && typeof mode === 'object') {
        setTimeout(() => ok({ coords: { latitude: mode.lat, longitude: mode.lng, accuracy: 5,
          altitude: null, heading: null, speed: null }, timestamp: Date.now() }), 50);
      }
      return 77;
    };
    navigator.geolocation.clearWatch = () => {};
  }, geo);
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.commFail && typeof commFailOptions === 'function'
    && typeof map === 'object' && map);
}

test('every entry point names a graph node and every field carries its chart', () => {
  for (const [icao, f] of Object.entries(DATA.fields)) {
    const af = AIRFIELDS.find(a => a.name === icao);
    expect(af && af.commfail_overlay, icao + ' has a comm-failure chart').toBeTruthy();
    expect(f.entries.length).toBeGreaterThan(0);
    for (const e of f.entries) {
      expect(GRAPH.nodes[e.wp], icao + ' entry ' + e.wp).toBeTruthy();
      expect(Number.isFinite(e.alt) && e.alt > 0).toBe(true);
    }
  }
});

test('the planner ranks fields by total distance and drops what does not resolve', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const data = { fields: {
      NEAR: { phone: '1', entries: [{ wp: 'A', alt: 1000 }, { wp: 'B', alt: 2000 }, { wp: 'GONE', alt: 9 }] },
      FAR: { entries: [{ wp: 'C', alt: 3000 }] },
      LOST: { entries: [{ wp: 'A', alt: 1000 }] },
    } };
    const pts = { A: { lat: 32.0, lng: 35.0 }, B: { lat: 32.3, lng: 34.9 }, C: { lat: 33.0, lng: 35.5 } };
    const fields = { NEAR: { lat: 32.3, lng: 34.8 }, FAR: { lat: 33.1, lng: 35.6 } };
    return commFailOptions(data, { lat: 32.4, lng: 34.9 }, c => pts[c] || null, i => fields[i] || null);
  });
  expect(out.map(o => o.icao)).toEqual(['NEAR', 'FAR']);           // LOST has no field position
  // B is nearer both to here and to the field than A, so it wins on the total leg.
  expect(out[0]).toMatchObject({ entry: 'B', alt: 2000, phone: '1' });
  expect(out[1].phone).toBe('');
});

test('from over the Sharon it routes to Herzliya and shows 7600 and a dialable phone', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => map.setView([32.36, 34.95], 10));   // north of training areas 8 and 9
  await page.click('#commfail-btn');
  const card = page.locator('[data-chart-modal="commfail"] .commfail-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.commfail-squawk')).toContainText('7600');
  await expect(card.locator('.commfail-dest')).toContainText('LLHZ');
  await expect(card.locator('a.tel-link')).toHaveAttribute('href', 'tel:099719554');
  await expect(card.locator('.commfail-origin')).toContainText('map centre');

  const route = await page.evaluate(() => ({
    names: state.waypoints.map(w => w.name),
    alts: state.legs.map(l => l.inboundAltitude),
    chart: document.getElementById('commfail-cb').checked,
    plateType: document.getElementById('plate-type').value,
  }));
  expect(route.names).toHaveLength(3);
  expect(route.names[2]).toBe('LLHZ');
  const entry = DATA.fields.LLHZ.entries.find(e => e.wp === route.names[1]);
  expect(entry, 'the middle point is a published Herzliya entry').toBeTruthy();
  expect(route.alts).toEqual([entry.alt, entry.alt]);
  expect(route.chart).toBe(true);
  expect(route.plateType).toBe('commfail-cb');
});

test('a drawn route is not replaced without asking, and No keeps it', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 31.5, lng: 34.8, name: 'X' }, { lat: 31.6, lng: 34.9, name: 'Y' }];
    syncLegs(); draw();
    map.setView([32.9, 35.4], 10);                   // Galilee: Rosh Pina's side
    window.askYesNo = async () => false;
  });
  await page.click('#commfail-btn');
  await page.waitForTimeout(300);
  const names = await page.evaluate(() => state.waypoints.map(w => w.name));
  expect(names).toEqual(['X', 'Y']);
  await expect(page.locator('[data-chart-modal="commfail"]')).toHaveCount(0);
});

test('Hebrew labels the card in Hebrew', async ({ page }) => {
  await boot(page, 'he');
  await page.evaluate(() => map.setView([32.9, 35.5], 10));
  await page.click('#commfail-btn');
  const card = page.locator('[data-chart-modal="commfail"] .commfail-card');
  await expect(card.locator('.commfail-squawk')).toContainText('סקווק');
  await expect(card.locator('.commfail-dest')).toContainText('LLIB');
});

test('from north of the training areas it enters at BAZRA at 1,600 and names the 1,200 from areas 3, 8, 9', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => map.setView([32.36, 34.95], 11));   // north of the training areas: from afar
  await page.click('#commfail-btn');
  const card = page.locator('[data-chart-modal="commfail"] .commfail-card');
  await expect(card.locator('.commfail-entry')).toContainText('BAZRA');
  await expect(card.locator('.commfail-entry')).toContainText('1,600 ft');
  await expect(card.locator('.commfail-entry-areas')).toContainText('1,200 ft from training areas 3, 8, 9');
  expect(await page.evaluate(() => state.legs.map(l => l.inboundAltitude))).toEqual([1600, 1600]);
});

const planned = (page) => page.evaluate(() => {
  state.waypoints = [{ lat: 31.5, lng: 34.8, name: 'X' }, { lat: 31.6, lng: 34.9, name: 'Y' }];
  syncLegs(); draw();
  map.setView([32.25, 34.95], 10);
  window.askYesNo = async () => true;
});

test('Cancel puts back the route and turns off the chart it turned on', async ({ page }) => {
  await boot(page);
  await planned(page);
  expect(await page.evaluate(() => document.getElementById('commfail-cb').checked)).toBe(false);
  await page.click('#commfail-btn');
  await expect(page.locator('.commfail-dest')).toBeVisible();
  expect(await page.evaluate(() => state.waypoints.length)).toBe(3);
  await page.click('.commfail-cancel');
  const after = await page.evaluate(() => ({
    names: state.waypoints.map(w => w.name),
    chart: document.getElementById('commfail-cb').checked,
    active: NavAid.commFail.isActive(),
  }));
  expect(after).toEqual({ names: ['X', 'Y'], chart: false, active: false });
  await expect(page.locator('[data-chart-modal="commfail"]')).toHaveCount(0);
});

test('Cancel after the pilot edited the route keeps the edit', async ({ page }) => {
  await boot(page);
  await planned(page);
  await page.click('#commfail-btn');
  await expect(page.locator('.commfail-dest')).toBeVisible();
  await page.evaluate(() => {
    state.waypoints.push({ lat: 32.2, lng: 34.7, name: 'Z' });
    syncLegs(); draw();
  });
  await page.click('.commfail-cancel');
  const names = await page.evaluate(() => state.waypoints.map(w => w.name));
  expect(names[names.length - 1]).toBe('Z');
  expect(names).toHaveLength(4);
});

test('the button is on/off like Location: pressed while active, and a second press ends it', async ({ page }) => {
  await boot(page);
  await planned(page);
  const pressed = () => page.evaluate(() => [document.getElementById('commfail-btn').getAttribute('aria-pressed'),
    NavAid.commFail.isActive()]);
  expect(await pressed()).toEqual(['false', false]);
  await page.click('#commfail-btn');
  await expect(page.locator('.commfail-dest')).toBeVisible();
  expect(await pressed()).toEqual(['true', true]);
  await page.click('#commfail-btn');
  expect(await pressed()).toEqual(['false', false]);
  expect(await page.evaluate(() => state.waypoints.map(w => w.name))).toEqual(['X', 'Y']);
  await expect(page.locator('[data-chart-modal="commfail"]')).toHaveCount(0);
});
test('with no position source it switches Location on and routes from the first fix', async ({ page }) => {
  // Over the Galilee while the map shows Herzliya: the route must start at the fix.
  await boot(page, 'en', { lat: 32.95, lng: 35.55 });
  await page.evaluate(() => map.setView([32.2, 34.85], 10));
  expect(await page.evaluate(() => gpsLiveOn)).toBe(false);
  await page.click('#commfail-btn');
  const card = page.locator('[data-chart-modal="commfail"] .commfail-card');
  await expect(card.locator('.commfail-origin')).toContainText('GPS');
  await expect(card.locator('.commfail-dest')).toContainText('LLIB');
  const r = await page.evaluate(() => ({ live: gpsLiveOn, pressed: document.getElementById('gps-live').getAttribute('aria-pressed'),
    first: state.waypoints[0] }));
  expect(r.live).toBe(true);
  expect(r.pressed).toBe('true');
  expect(r.first.lat).toBeCloseTo(32.95, 3);
  // Cancel turns off the Location it turned on.
  await page.click('.commfail-cancel');
  expect(await page.evaluate(() => gpsLiveOn)).toBe(false);
});

test('Location already on stays on after Cancel', async ({ page }) => {
  await boot(page, 'en', { lat: 32.25, lng: 34.95 });
  await page.click('#gps-live');
  await page.waitForFunction(() => typeof gpsLastFix === 'function' && gpsLastFix());
  await page.click('#commfail-btn');
  await expect(page.locator('.commfail-dest')).toBeVisible();
  expect(await page.evaluate(() => window.__geoStarts)).toBe(1);
  await page.click('.commfail-cancel');
  expect(await page.evaluate(() => gpsLiveOn)).toBe(true);
});

test('No on the replace question turns off the Location it turned on', async ({ page }) => {
  await boot(page, 'en', { lat: 32.25, lng: 34.95 });
  await page.evaluate(() => {
    state.waypoints = [{ lat: 31.5, lng: 34.8, name: 'X' }, { lat: 31.6, lng: 34.9, name: 'Y' }];
    syncLegs(); draw();
    window.askYesNo = async () => false;
  });
  await page.click('#commfail-btn');
  await page.waitForFunction(() => window.__geoStarts === 1 && !gpsLiveOn);
  expect(await page.evaluate(() => state.waypoints.map(w => w.name))).toEqual(['X', 'Y']);
});

const fixAt = (page, lat, lng) => page.evaluate(([la, ln]) => window.__geoOk({ coords: { latitude: la, longitude: ln,
  accuracy: 5, altitude: null, heading: null, speed: null }, timestamp: Date.now() }), [lat, lng]);

test('it waits for the GPS as long as it takes, showing 7600 meanwhile', async ({ page }) => {
  await boot(page, 'en', 'hold');
  await page.evaluate(() => map.setView([32.2, 34.85], 10));
  await page.click('#commfail-btn');
  const card = page.locator('[data-chart-modal="commfail"] .commfail-card');
  await expect(card.locator('.commfail-waiting')).toBeVisible();
  await expect(card.locator('.commfail-squawk')).toContainText('7600');
  await page.waitForTimeout(9000);                       // past the old 8 s give-up
  expect(await page.evaluate(() => state.waypoints.length)).toBe(0);
  await fixAt(page, 32.95, 35.55);
  await expect(card.locator('.commfail-dest')).toContainText('LLIB');
  await expect(card.locator('.commfail-origin')).toContainText('GPS');
});

test('Use map centre routes from the map without waiting', async ({ page }) => {
  await boot(page, 'en', 'hold');
  await page.evaluate(() => map.setView([32.25, 34.95], 10));
  await page.click('#commfail-btn');
  await page.click('.commfail-use-centre');
  const card = page.locator('[data-chart-modal="commfail"] .commfail-card');
  await expect(card.locator('.commfail-dest')).toContainText('LLHZ');
  await expect(card.locator('.commfail-origin')).toContainText('map centre');
});

test('Cancel while waiting draws nothing and turns Location back off', async ({ page }) => {
  await boot(page, 'en', 'hold');
  await page.click('#commfail-btn');
  await page.click('.commfail-cancel');
  await expect(page.locator('[data-chart-modal="commfail"]')).toHaveCount(0);
  expect(await page.evaluate(() => ({ n: state.waypoints.length, live: gpsLiveOn }))).toEqual({ n: 0, live: false });
  await fixAt(page, 32.95, 35.55);                       // a late fix changes nothing
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => state.waypoints.length)).toBe(0);
});

test('pressing again while it waits for GPS ends it', async ({ page }) => {
  await boot(page, 'en', 'hold');
  await page.click('#commfail-btn');
  await expect(page.locator('.commfail-waiting')).toBeVisible();
  expect(await page.evaluate(() => document.getElementById('commfail-btn').getAttribute('aria-pressed'))).toBe('true');
  await page.click('#commfail-btn');
  await expect(page.locator('[data-chart-modal="commfail"]')).toHaveCount(0);
  expect(await page.evaluate(() => [gpsLiveOn, document.getElementById('commfail-btn').getAttribute('aria-pressed')]))
    .toEqual([false, 'false']);
});

test('inside a listed training area its entry wins, at the areas\' altitude', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(() => {
    const sq = [[32.3, 34.9], [32.3, 35.0], [32.2, 35.0], [32.2, 34.9]];
    const data = { fields: { F: { trainingAreas: { areas: { 8: sq } }, entries: [
      { wp: 'NEAR', alt: 1000 },
      { wp: 'FAR', alt: 1600, fromAreas: { alt: 1200, areas: [3, 8, 9] } },
    ] } } };
    const pts = { NEAR: { lat: 32.25, lng: 34.96 }, FAR: { lat: 32.0, lng: 34.6 } };
    const at = c => pts[c] || null;
    const field = () => ({ lat: 32.1, lng: 34.8 });
    return {
      inside: commFailOptions(data, { lat: 32.25, lng: 34.95 }, at, field)[0],
      outside: commFailOptions(data, { lat: 32.35, lng: 34.95 }, at, field)[0],
    };
  });
  expect(out.inside).toMatchObject({ entry: 'FAR', alt: 1200, inArea: '8' });
  expect(out.outside).toMatchObject({ entry: 'NEAR', alt: 1000, inArea: null });
});

test('from training area 3 it returns to Herzliya via BAZRA at 1,200 and says why', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => map.setView([32.19, 34.93], 11));
  await page.click('#commfail-btn');
  const card = page.locator('[data-chart-modal="commfail"] .commfail-card');
  await expect(card.locator('.commfail-entry')).toContainText('BAZRA');
  await expect(card.locator('.commfail-entry')).toContainText('1,200 ft');
  await expect(card.locator('.commfail-entry-areas')).toContainText('training area 3');
  expect(await page.evaluate(() => state.legs.map(l => l.inboundAltitude))).toEqual([1200, 1200]);
});

test('the card carries the tower light signals, open on a larger screen, in both languages', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await boot(page, 'he');
  await page.evaluate(() => map.setView([32.9, 35.5], 10));
  await page.click('#commfail-btn');
  const lights = page.locator('[data-chart-modal="commfail"] .commfail-lights');
  await expect(lights).toHaveAttribute('open', '');
  await expect(lights.locator('dd')).toHaveCount(6);
  await expect(lights).toContainText('ירוק רציף');
  await expect(lights).toContainText('מותר לנחות');
});

test('on a phone the light signals start folded, and one tap opens them', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await boot(page);
  await page.evaluate(() => {
    map.setView([32.9, 35.5], 10);
    document.getElementById('boot-loading')?.remove();
    document.documentElement.classList.remove('app-booting');
  });
  await page.locator('.deck-btn-commfail').click();
  const lights = page.locator('[data-chart-modal="commfail"] .commfail-lights');
  await expect(lights).not.toHaveAttribute('open', '');
  await expect(lights.locator('dd').first()).toBeHidden();
  await lights.locator('summary').click();
  await expect(lights.locator('dd').first()).toBeVisible();
});
