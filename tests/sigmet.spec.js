// SIGMET hazard overlay — toggle, fetch (raw branch with same-origin
// fallback), polygon draw, and the corner status readout.
const { test, expect } = require('@playwright/test');

async function boot(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.view', '1'); } catch (e) {}
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

test('toggle off by default, opt-in, persists', async ({ page }) => {
  await page.route('**raw.githubusercontent.com/**sigmet-data/**', r =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(SAMPLE) }));
  await boot(page);
  const cb = page.locator('#sigmet-cb');
  await expect(cb).not.toBeChecked();
  expect(await page.evaluate(() => window.showSigmet)).toBeFalsy();
  await cb.check();
  await page.waitForFunction(() => Array.isArray(sigmets) && sigmets.length === 1);
  expect(await page.evaluate(() => localStorage.getItem('navaid.showSigmet'))).toBe('1');
  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined');
  await expect(page.locator('#sigmet-cb')).toBeChecked();
});

test('fetched SIGMET populates the overlay and the status readout', async ({ page }) => {
  await page.route('**raw.githubusercontent.com/**sigmet-data/**', r =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(SAMPLE) }));
  await boot(page);
  await page.locator('#sigmet-cb').check();
  await page.waitForFunction(() => Array.isArray(sigmets) && sigmets.length === 1);
  // draw() must not throw with a SIGMET polygon present.
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.4, lng: 35.1, name: 'B' }];
    syncLegs(); draw();
  });
  const readout = page.locator('#sigmet-readout');
  await expect(readout).toHaveClass(/show/);
  await expect(readout).toContainText('1 SIGMET');
  await expect(readout).toHaveAttribute('title', /OBSC TS/);
});

test('empty feed shows the calm "no SIGMET" readout', async ({ page }) => {
  await page.route('**raw.githubusercontent.com/**sigmet-data/**', r =>
    r.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ generatedAt: null, sigmets: [] }) }));
  await boot(page);
  await page.locator('#sigmet-cb').check();
  await page.waitForFunction(() => Array.isArray(sigmets));
  const readout = page.locator('#sigmet-readout');
  await expect(readout).toHaveClass(/sigmet-none/);
  await expect(readout).toContainText(/No SIGMET/i);
});

test('falls back to same-origin data/sigmet.json when the raw branch fails', async ({ page }) => {
  await page.route('**raw.githubusercontent.com/**sigmet-data/**', r =>
    r.fulfill({ status: 404, body: 'not found' }));
  await boot(page);
  await page.locator('#sigmet-cb').check();
  // The committed placeholder is an empty list — load must resolve, not throw.
  await page.waitForFunction(() => Array.isArray(sigmets));
  expect(await page.evaluate(() => sigmets.length)).toBe(0);
  await expect(page.locator('#sigmet-readout')).toHaveClass(/sigmet-none/);
});
