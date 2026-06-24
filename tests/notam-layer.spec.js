// @ts-check
// NOTAM overlay + list. A scheduled Action publishes notam.json to the
// notam-data branch; the app draws areas on the canvas (toggle) and lists the
// full texts in a modal. Hidden/empty until data loads.
const { test, expect } = require('./_setup');

const NOTAM_RE = /notam-data\/notam\.json/;

const DATA = {
  generatedAt: '2026-06-23T09:00:00Z',
  source: 'FAA NOTAM API', fir: 'LLLL',
  notams: [
    { id: 'A0483/26', text: 'A0483/26 LLLL E) ATS RTE J14 CLSD BTN ZACCI-MEGID.', end: '2026-12-31T23:59:00Z',
      geom: { type: 'polygon', coords: [[32.0, 34.8], [32.2, 34.9], [31.9, 35.1]] } },
    { id: 'C1337/26', text: 'C1337/26 LLLL E) AREA AT RISHON LE-ZION CLSD DUE FIREFIGHTING.', end: '2026-07-01T00:00:00Z',
      geom: { type: 'circle', lat: 31.96, lng: 34.8, radiusNm: 3 } },
    { id: 'C1333/26', text: 'C1333/26 LLLL E) PJE AIRSPACE METZADA ACT FM 8000FT AMSL.', end: '', geom: null },
  ],
};

async function boot(page, body) {
  await page.route(NOTAM_RE, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body || DATA) }));
  await page.addInitScript(() => { try { localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {} });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof draw === 'function' && document.getElementById('notam-cb'));
}

test('NOTAM list button reveals when data loads and lists all NOTAMs', async ({ page }) => {
  await boot(page);
  const btn = page.locator('#notam-list-btn');
  await expect(btn).toBeVisible();
  await btn.click();
  const modal = page.locator('.modal-back .notam-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.notam-item')).toHaveCount(3);
  await expect(modal).toContainText('A0483/26');
  await expect(modal).toContainText('METZADA');
  // Esc closes.
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-back .notam-modal')).toHaveCount(0);
});

test('toggling the overlay loads NOTAMs and draws without error', async ({ page }) => {
  await boot(page);
  await page.locator('#notam-cb').check();
  const s = await page.evaluate(() => ({ on: window.showNotam, n: Array.isArray(notams) ? notams.length : -1 }));
  expect(s.on).toBe(true);
  expect(s.n).toBe(3);
  // Toggle persists across reload.
  await page.reload();
  await page.waitForFunction(() => document.getElementById('notam-cb'));
  await expect(page.locator('#notam-cb')).toBeChecked();
});

test('no NOTAMs → list button stays hidden', async ({ page }) => {
  await boot(page, { generatedAt: null, notams: [] });
  await page.waitForTimeout(400);
  await expect(page.locator('#notam-list-btn')).toBeHidden();
});

test('NOTAMs decode to plain English; Raw toggle shows the source text', async ({ page }) => {
  await boot(page, { generatedAt: '2026-06-23T09:00:00Z', notams: [
    { id: 'C0003/26', type: 'RDCS', end: 'PERM', geom: null, icao: 'LLLL',
      text: 'LLD41 ESTABLISHED BTN 2,000-8,000FT AMSL.\n   OPS WITH PPR FM ATC.\n   CTN ADZ.' },
  ] });
  // decodeNotam: Q-code head + expanded abbreviations.
  const dec = await page.evaluate(() => decodeNotam({
    type: 'RDCS', text: 'LLD41 ESTABLISHED BTN 2,000-8,000FT AMSL.\n   OPS WITH PPR FM ATC.' }));
  expect(dec).toContain('Danger area');             // RD subject
  expect(dec).toContain('installed');               // CS condition
  expect(dec).toContain('above mean sea level');    // AMSL expanded
  expect(dec).toContain('between');                 // BTN expanded
  await page.locator('#notam-list-btn').click();
  const modal = page.locator('.modal-back .notam-modal');
  await expect(modal.locator('.notam-text')).toContainText('above mean sea level');
  // Raw toggle flips to the original source text.
  await modal.locator('.notam-raw-toggle').click();
  await expect(modal.locator('.notam-text')).toContainText('AMSL');
  await expect(modal.locator('.notam-text')).not.toContainText('above mean sea level');
});

test('timeline slider scrubs which NOTAMs are active', async ({ page }) => {
  const started = new Date(Date.now() - 36e5).toISOString();     // -1h (already active)
  const startIn48 = new Date(Date.now() + 48 * 3600e3).toISOString();
  const farEnd = new Date(Date.now() + 30 * 864e5).toISOString();
  await boot(page, { generatedAt: '2026-06-23T09:00:00Z', notams: [
    { id: 'N-NOW/26', text: 'active now', start: started, end: farEnd, geom: null, icao: 'LLBG' },
    { id: 'N-LATER/26', text: 'starts in 48h', start: startIn48, end: farEnd, geom: null, icao: 'LLHA' },
  ] });
  await page.locator('#notam-cb').check();
  // Slider hidden until overlay on; now visible with data.
  await expect(page.locator('#notam-controls')).toBeVisible();
  // At "now" only the started NOTAM is active.
  expect(await page.evaluate(() => activeNotams().length)).toBe(1);
  // Scrub to +60h → the later NOTAM is now active too.
  await page.locator('#notam-time').fill('60');
  await page.locator('#notam-time').dispatchEvent('input');
  expect(await page.evaluate(() => activeNotams().map(n => n.id).sort()))
    .toEqual(['N-LATER/26', 'N-NOW/26']);
  // Modal title reflects the scrubbed count.
  await page.locator('#notam-list-btn').click();
  await expect(page.locator('.modal-back .notam-modal h3')).toContainText('2');
});

test('CVFR route closures resolve named fixes to closed + diverted lines', async ({ page }) => {
  // Fix names are resolved against the real nav-waypoints.json (not mocked).
  await boot(page, { generatedAt: '2026-06-23T09:00:00Z', notams: [
    { id: 'C1320/26', type: 'ARLC', end: 'PERM', geom: null, icao: 'LLLL',
      text: 'CVFR RTE CLSD:\n   NEGEV-HOVAV-OHLIM-OMMER-ZGOAL.\n   HOVAV-SOKET.\n'
          + '   TFC WILL BE DIVERTED VIA BKAMA-SOKET-ARRAD-ZOHAR' },
  ] });
  await page.locator('#notam-cb').check();
  const rl = await page.evaluate(() => {
    if (typeof buildNotamRouteLines === 'function') buildNotamRouteLines();
    const n = notams.find(x => x.id === 'C1320/26');
    return (n._routeLines || []).map(l => ({ kind: l.kind, pts: l.coords.length }));
  });
  const closed = rl.filter(l => l.kind === 'closed');
  const diverted = rl.filter(l => l.kind === 'diverted');
  expect(closed.length).toBeGreaterThanOrEqual(2);   // multiple closed segments
  expect(diverted.length).toBe(1);                   // one reroute
  expect(closed.every(l => l.pts >= 2)).toBe(true);
});

test('clicking a NOTAM area on the map opens just that NOTAM', async ({ page }) => {
  await boot(page);
  await page.locator('#notam-cb').check();
  // notamsAtLatLng hit-tests in canvas space via proj(); a point inside the
  // C1337/26 circle (centre 31.96/34.8) should resolve to that NOTAM alone.
  const hit = await page.evaluate(() => {
    const got = notamsAtLatLng({ lat: 31.96, lng: 34.8 });
    return { ids: got.map(n => n.id) };
  });
  expect(hit.ids).toContain('C1337/26');
  // The single-NOTAM modal shows the clicked subset, not the full list.
  await page.evaluate(() => showNotamModal(notamsAtLatLng({ lat: 31.96, lng: 34.8 })));
  const modal = page.locator('.modal-back .notam-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.notam-item')).toHaveCount(1);
  await expect(modal).toContainText('C1337/26');
  await expect(modal).not.toContainText('A0483/26');
});

test('expired NOTAMs are filtered out; modal shows the active count', async ({ page }) => {
  const past = new Date(Date.now() - 864e5).toISOString();      // yesterday
  const future = new Date(Date.now() + 864e5).toISOString();
  await boot(page, { generatedAt: '2026-06-23T09:00:00Z', notams: [
    { id: 'X1/26', text: 'active', end: future, geom: null, icao: 'LLBG' },
    { id: 'X2/26', text: 'expired', end: past, geom: null, icao: 'LLBG' },
    { id: 'X3/26', text: 'perm', end: 'PERM', geom: null, icao: 'LLHA' },
  ] });
  await page.locator('#notam-list-btn').click();
  const modal = page.locator('.modal-back .notam-modal');
  await expect(modal.locator('.notam-item')).toHaveCount(2);    // expired dropped
  await expect(modal.locator('h3')).toContainText('2');         // active count in title
  await expect(modal).not.toContainText('X2/26');
});
