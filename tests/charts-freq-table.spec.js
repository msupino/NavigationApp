// @ts-check
// The Charts toolbar exposes a dedicated route-wide frequency catalog editor.
// Users can set local call-sign frequencies there, and the overrides should
// use the same navaid.commFreqOverrides store as the inspector editor.
const { test, expect } = require('./_setup');

const DEROR = { lat: 32.25722, lng: 34.89111, name: 'DEROR' };
const DAROM = { lat: 32.79611, lng: 34.94333, name: 'DAROM' };

const FIXTURE = {
  version: 1,
  source: 'test fixture',
  callSigns: {
    AZAM: { label: 'Azam', he: 'עזם', primary: '123.70' },
    HERZLIYA: { label: 'Herzliya', he: 'הרצליה', primary: '122.20' },
    PLUTO: { label: 'Pluto', he: 'פלוטו', primary: '118.40' },
  },
  points: [
    { name: 'TYONA', commChange: true, callSigns: ['PLUTO'] },
    { name: 'DEROR', commChange: true, callSigns: ['HERZLIYA'] },
    { name: 'DAROM', commChange: true, callSigns: ['HERZLIYA'] },
  ],
};

async function installCommChangeFixture(page) {
  await page.route('**/comm-change.json*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(FIXTURE),
  }));
}

async function boot(page) {
  await page.addInitScript(() => {
    try {
      for (const k of Object.keys(localStorage)) localStorage.removeItem(k);
      sessionStorage.clear();
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + s, '1');
    } catch (e) {}
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof showChartsModal === 'function' &&
    typeof showFreqTableModal === 'function' && typeof seedCommChangeNotes === 'function');
  await page.evaluate(() => loadNavWaypoints());
  await page.waitForFunction(() => Array.isArray(window.navWP) && window.navWP.length > 0);
  await page.evaluate(() => loadAirfields());
  await page.waitForFunction(() => Array.isArray(window.airfields) && window.airfields.length > 0);
  await page.evaluate(() => loadCommChange());
  await page.waitForFunction(() => window.commChangeMap && window.commChangeMap.DEROR);
}

test.describe('Charts modal — frequency catalog table', () => {
  test('Charts toolbar section exposes the frequency table entry point', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    const button = page.locator('.tb-section[data-sec="charts"] #freq-table');
    await expect(button).toBeVisible();
    await expect(button).toHaveText('📡 Freq table');

    await button.click();
    await expect(page.locator('.charts-freq-title h3')).toHaveText('Frequency defaults');
    await expect(page.locator('.charts-freq-table thead th').nth(2))
      .toHaveText('Override');
    const herzliya = page.locator('.charts-freq-input[data-call-sign="HERZLIYA"]');
    await expect(herzliya).toHaveAttribute('type', 'number');
    await expect(herzliya).toHaveAttribute('min', '118');
    await expect(herzliya).toHaveAttribute('max', '136.975');
    await expect(herzliya).toHaveAttribute('step', '0.005');
    await expect(herzliya).toHaveValue('122.20');
    await expect(page.locator('.charts-freq-input[data-call-sign="AZAM"]'))
      .toHaveCount(0);
    await expect(page.locator('.charts-airport-header')).toHaveCount(0);
  });

  test('Airport charts entry point stays chart-only', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.locator('#charts').click();
    await expect(page.locator('.charts-airport-header').first()).toBeVisible();
    await expect(page.locator('.charts-freq-title')).toHaveCount(0);
    await expect(page.locator('.charts-freq-table')).toHaveCount(0);
  });

  test('search filters frequency table rows', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.locator('#freq-table').click();

    const search = page.locator('.charts-freq-search');
    await expect(search).toHaveAttribute('placeholder', 'Search frequencies');
    await expect(page.locator('.charts-freq-input[data-call-sign="HERZLIYA"]'))
      .toBeVisible();
    await expect(page.locator('.charts-freq-input[data-call-sign="PLUTO"]'))
      .toBeVisible();
    await expect(page.locator('.charts-freq-input[data-call-sign="AZAM"]'))
      .toHaveCount(0);

    await search.fill('plu');
    await expect(page.locator('.charts-freq-input[data-call-sign="PLUTO"]'))
      .toBeVisible();
    await expect(page.locator('.charts-freq-input[data-call-sign="HERZLIYA"]'))
      .toBeHidden();
    await expect(page.locator('.charts-freq-no-matches')).toBeHidden();

    await search.fill('122.20');
    await expect(page.locator('.charts-freq-input[data-call-sign="HERZLIYA"]'))
      .toBeVisible();
    await expect(page.locator('.charts-freq-input[data-call-sign="PLUTO"]'))
      .toBeHidden();

    await search.fill('azam');
    await expect(page.locator('.charts-freq-no-matches'))
      .toHaveText('No matching frequencies');

    await search.fill('nope');
    await expect(page.locator('.charts-freq-input[data-call-sign="HERZLIYA"]'))
      .toBeHidden();
    await expect(page.locator('.charts-freq-input[data-call-sign="PLUTO"]'))
      .toBeHidden();
    await expect(page.locator('.charts-freq-no-matches'))
      .toHaveText('No matching frequencies');
  });

  test('edits local frequencies and restores originals', async ({ page }) => {
    await installCommChangeFixture(page);
    await boot(page);
    await page.evaluate(({ deror, darom }) => {
      localStorage.removeItem('navaid.commFreqOverrides');
      window.showCommChange = true;
      state.waypoints = [deror, darom];
      state.notes = [];
      syncLegs();
      seedCommChangeNotes();
      showFreqTableModal();
    }, { deror: DEROR, darom: DAROM });

    const herzliya = page.locator('.charts-freq-input[data-call-sign="HERZLIYA"]');
    const pluto = page.locator('.charts-freq-input[data-call-sign="PLUTO"]');
    const restoreAll = page.locator('.charts-freq-restore-all');
    const herzliyaRow = page.locator('.charts-freq-table tr', {
      has: page.locator('.charts-freq-input[data-call-sign="HERZLIYA"]'),
    });
    const herzliyaReset = herzliyaRow.locator('.commchange-freq-reset');

    await expect(page.locator('.charts-freq-title h3')).toHaveText('Frequency defaults');
    await expect(herzliya).toHaveValue('122.20');
    await expect(pluto).toHaveValue('118.40');
    await expect(restoreAll).toBeDisabled();
    await expect(herzliyaReset).toBeDisabled();
    await expect(herzliyaRow).not.toHaveClass(/overridden/);

    await herzliya.fill('137.00');
    await herzliya.press('Enter');
    await expect(herzliya).toHaveAttribute('aria-invalid', 'true');
    await expect(restoreAll).toBeDisabled();
    await expect(herzliyaReset).toBeEnabled();
    expect(await page.evaluate(() => localStorage.getItem('navaid.commFreqOverrides'))).toBeNull();
    await herzliyaReset.click();
    await expect(herzliya).toHaveValue('122.20');
    await expect(herzliya).toHaveAttribute('aria-invalid', 'false');
    await expect(herzliyaReset).toBeDisabled();

    await herzliya.fill('125.60');
    await herzliya.press('Enter');
    await expect(restoreAll).toBeEnabled();
    await expect(herzliyaReset).toBeEnabled();
    await expect(herzliya).toHaveValue('125.60');
    await expect(herzliyaRow).toHaveClass(/overridden/);

    const edited = await page.evaluate(() => ({
      overrides: JSON.parse(localStorage.getItem('navaid.commFreqOverrides') || '{}'),
      notes: state.notes.map(n => ({
        cc: n.cc,
        freqName: n.freqName,
        freq: n.freq,
        lines: noteLines(n),
      })),
    }));
    expect(edited.overrides).toEqual({ HERZLIYA: '125.60' });
    expect(edited.notes).toEqual([
      { cc: 'DEROR', freqName: 'HERZLIYA', freq: '125.60', lines: ['HERZLIYA', '125.60'] },
      { cc: 'DAROM', freqName: 'HERZLIYA', freq: '125.60', lines: ['HERZLIYA', '125.60'] },
    ]);

    await herzliyaReset.click();
    await expect(herzliya).toHaveValue('122.20');
    await expect(restoreAll).toBeDisabled();
    await expect(herzliyaReset).toBeDisabled();
    await expect(herzliyaRow).not.toHaveClass(/overridden/);
    const rowRestored = await page.evaluate(() => ({
      rawOverrides: localStorage.getItem('navaid.commFreqOverrides'),
      notes: state.notes.map(n => ({
        cc: n.cc,
        freqName: n.freqName,
        freq: n.freq,
        lines: noteLines(n),
      })),
    }));
    expect(rowRestored.rawOverrides).toBeNull();
    expect(rowRestored.notes).toEqual([
      { cc: 'DEROR', freqName: 'HERZLIYA', freq: '122.20', lines: ['HERZLIYA', '122.20'] },
      { cc: 'DAROM', freqName: 'HERZLIYA', freq: '122.20', lines: ['HERZLIYA', '122.20'] },
    ]);

    await herzliya.fill('125.60');
    await herzliya.press('Enter');
    await pluto.fill('119.20');
    await pluto.press('Enter');
    await expect(restoreAll).toBeEnabled();
    await restoreAll.click();
    await expect(herzliya).toHaveValue('122.20');
    await expect(pluto).toHaveValue('118.40');
    await expect(restoreAll).toBeDisabled();
    expect(await page.evaluate(() => localStorage.getItem('navaid.commFreqOverrides'))).toBeNull();
  });
});
