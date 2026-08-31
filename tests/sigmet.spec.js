// SIGMET hazard overlay — toggle, fetch (raw branch with same-origin
// fallback), polygon draw, and the corner status readout.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.charts', '1'); localStorage.setItem('navaid.sec.weather', '1'); } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof loadSigmets === 'function' && typeof sigmetHazardColor === 'function' &&
    typeof draw === 'function');
}

const SAMPLE = {
  generatedAt: '2026-06-11T09:00:00Z',
  source: 'NOAA AWC isigmet',
  sigmets: [{
    id: 'LLLL-1', firId: 'LLLL', firName: 'TEL AVIV', hazard: 'TS', qualifier: 'OBSC',
    base: 0, top: 30000, validFrom: 0, validTo: 0,
    coords: [[33.2, 34.3], [33.2, 35.6], [31.2, 35.6], [31.2, 34.3]],
    raw: 'LLLL SIGMET 1 VALID ... OBSC TS FCST',
  }],
};

test('sigmetHazardColor maps hazards (TS red, others distinct, unknown→red)', async ({ page }) => {
  await boot(page);
  const c = await page.evaluate(() => ({
    ts: sigmetHazardColor('TS'), turb: sigmetHazardColor('TURB'),
    ice: sigmetHazardColor('ICE'), va: sigmetHazardColor('VA'),
    unknown: sigmetHazardColor('ZZZ'), empty: sigmetHazardColor(''),
  }));
  expect(c.ts).toBe('#dd1111');
  expect(c.unknown).toBe('#dd1111');
  expect(c.empty).toBe('#dd1111');
  expect(new Set([c.turb, c.ice, c.va]).size).toBe(3);   // all distinct
  expect(c.turb).not.toBe(c.ts);
});

test('the SIGMET chart button appears on boot when active SIGMETs load', async ({ page }) => {
  await page.route('**raw.githubusercontent.com/**sigmet-data/**', r =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(SAMPLE) }));
  await boot(page);
  // Eager boot load populates sigmets and unhides the Charts-section button.
  await page.waitForFunction(() => Array.isArray(sigmets) && sigmets.length === 1);
  await page.waitForFunction(() => {
    const b = document.getElementById('sigmet-btn'); return b && b.hidden === false;
  });
  // No map overlay is drawn any more — draw() must stay clean with SIGMETs loaded.
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
    syncLegs(); draw();
  });
  expect(await page.evaluate(() => document.getElementById('sigmet-readout'))).toBeNull();
});

test('clicking the SIGMET button opens the decoded-list modal', async ({ page }) => {
  await page.route('**raw.githubusercontent.com/**sigmet-data/**', r =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(SAMPLE) }));
  await boot(page);
  await page.waitForFunction(() => {
    const b = document.getElementById('sigmet-btn'); return b && b.hidden === false;
  });
  await page.evaluate(() => document.getElementById('sigmet-btn').click());
  const modal = page.locator('.modal-back .modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.modal-title')).toContainText(/SIGMET/i);
  await expect(modal).toContainText(/Obscured Thunderstorm/);
});

test('empty feed leaves the SIGMET button hidden', async ({ page }) => {
  await page.route('**raw.githubusercontent.com/**sigmet-data/**', r =>
    r.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ generatedAt: null, sigmets: [] }) }));
  await boot(page);
  await page.waitForFunction(() => Array.isArray(sigmets));
  expect(await page.evaluate(() => sigmets.length)).toBe(0);
  await expect(page.locator('#sigmet-btn')).toBeHidden();
});

test('falls back to same-origin data/sigmet.json when the raw branch fails', async ({ page }) => {
  await page.route('**raw.githubusercontent.com/**sigmet-data/**', r =>
    r.fulfill({ status: 404, body: 'not found' }));
  await boot(page);
  // The committed placeholder is an empty list — load must resolve, not throw.
  await page.waitForFunction(() => Array.isArray(sigmets));
  expect(await page.evaluate(() => sigmets.length)).toBe(0);
  await expect(page.locator('#sigmet-btn')).toBeHidden();   // nothing active → no button
});

test('an expired SIGMET hides the button and is not listed', async ({ page }) => {
  await page.route('**raw.githubusercontent.com/**sigmet-data/**', r => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ generatedAt: null, sigmets: [{
      firId: 'LLLL', firName: 'TEL AVIV', hazard: 'TURB', qualifier: 'SEV',
      base: 8000, top: 18000,
      validFrom: 1577836800, validTo: 1577851200,   // 2020-01-01, long expired
      coords: [[33, 34], [33, 35], [31, 35], [31, 34]],
      raw: 'LLLL SIGMET 9 VALID ... EXPIRED-MARKER',
    }] }),
  }));
  await page.goto('?lang=en');
  await page.waitForFunction(() => Array.isArray(sigmets) && sigmets.length === 1);
  // The datum is present but out of force: no active SIGMET, so no button.
  expect(await page.evaluate(() => activeSigmets().length)).toBe(0);
  expect(await page.evaluate(() => document.getElementById('sigmet-btn').hidden)).toBe(true);
  // Even opened directly, the decoded list skips the expired one.
  await page.evaluate(() => { if (typeof showSigmetDecoded === 'function') showSigmetDecoded(); });
  expect(await page.evaluate(() => !!document.querySelector('.modal-back .modal'))).toBe(false);
});

test('a non-positive validTo (NOAA no-bound) stays in force', async ({ page }) => {
  await page.route('**raw.githubusercontent.com/**sigmet-data/**', r => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ generatedAt: null, sigmets: [{
      firId: 'LLLL', firName: 'TEL AVIV', hazard: 'TS', base: 0, top: 30000,
      validFrom: 0, validTo: 0, coords: [[33, 34], [33, 35], [31, 35]], raw: 'open',
    }] }),
  }));
  await page.goto('?lang=en');
  await page.waitForFunction(() => Array.isArray(sigmets) && sigmets.length === 1);
  expect(await page.evaluate(() => activeSigmets().length)).toBe(1);   // 0/0 = open, still active
  expect(await page.evaluate(() => document.getElementById('sigmet-btn').hidden)).toBe(false);
});
