// SIGMET decoder — turns coded fields into plain language, plus the
// click-to-open decoded list on the corner readout.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.sec.view', '1'); localStorage.setItem('navaid.showSigmet', '1'); } catch (e) {}
  });
  await page.route('**raw.githubusercontent.com/**sigmet-data/**', r => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      generatedAt: '2026-06-14T06:00:00Z',
      sigmets: [{
        firId: 'LLLL', firName: 'TEL AVIV', hazard: 'TURB', qualifier: 'SEV',
        base: 8000, top: 18000, dir: 'SE', spd: 20,
        validFrom: 1781503200, validTo: 1781517600,   // 06:00Z – 10:00Z 2026-06-14
        coords: [[33.1, 34.5], [33.1, 35.5], [31.6, 35.6], [31.5, 34.6]],
        raw: 'LLLL SIGMET 2 VALID ... SEV TURB FCST',
      }],
    }),
  }));
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof decodeSigmet === 'function');
}

test('decodeSigmet builds a plain-language sentence', async ({ page }) => {
  await boot(page);
  const txt = await page.evaluate(() => decodeSigmet({
    firName: 'TEL AVIV', hazard: 'TURB', qualifier: 'SEV',
    base: 8000, top: 18000, dir: 'SE', spd: 20,
    validFrom: 1781503200, validTo: 1781517600,
  }));
  expect(txt).toContain('TEL AVIV');
  expect(txt).toContain('Severe Turbulence');
  expect(txt).toContain('FL080');
  expect(txt).toContain('FL180');
  expect(txt).toMatch(/moving SE 20 kt/);
  expect(txt).toMatch(/valid \d\d:\d\dZ–\d\d:\d\dZ/);
});

test('decodeSigmet handles unknown codes + surface base', async ({ page }) => {
  await boot(page);
  const txt = await page.evaluate(() => decodeSigmet({ hazard: 'ZZZ', base: 0, top: 5000 }));
  expect(txt).toContain('ZZZ');           // unknown hazard passed through
  expect(txt).toContain('SFC');           // base 0 → SFC
  expect(txt).toContain('FL050');         // 5000 ft → FL050
});

test('clicking the SIGMET readout opens the decoded list', async ({ page }) => {
  await boot(page);
  await page.locator('#sigmet-cb').check();
  await page.waitForFunction(() => Array.isArray(sigmets) && sigmets.length === 1);
  await page.locator('#sigmet-readout').click();
  const modal = page.locator('.modal-title', { hasText: /SIGMET/i });
  await expect(modal).toBeVisible();
  const body = page.locator('.modal-back .modal');
  await expect(body).toContainText('Severe Turbulence');
  await expect(body).toContainText('Raw:');           // raw text shown too
});
