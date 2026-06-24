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
