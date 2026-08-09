// @ts-check
// Regression coverage for the CVFR altitude-pair table direction columns.
const { test, expect } = require('./_setup');
const { stubGraph } = require('./_layerData');

const ALTITUDE_FIXTURE = {
  version: 1,
  source: 'altitude direction column fixture',
  segments: [
    {
      from: 'AAKKO',
      to: 'AHIUD',
      distanceNm: 4.3,
      inboundAltitude: null,
      outboundAltitude: 2000,
      oneWay: true,
    },
    {
      from: 'BAZRA',
      to: 'DEROR',
      distanceNm: 2.4,
      inboundAltitude: 800,
      outboundAltitude: 2000,
    },
  ],
};

async function installAltitudeFixture(page) {
  await stubGraph(page, { segments: ALTITUDE_FIXTURE.segments });
}

async function boot(page, lang) {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('navaid.sec.charts', '1');
    } catch (e) {}
  });
  await page.goto('?lang=' + encodeURIComponent(lang));
  await page.waitForFunction(() => typeof showAltitudePairsModal === 'function');
}

async function cssSnapshot(locator) {
  return locator.evaluate(el => {
    const style = getComputedStyle(el);
    return {
      direction: style.direction,
      unicodeBidi: style.unicodeBidi,
    };
  });
}

test.describe('Altitude pair direction columns', () => {
  test('Hebrew table separates directions from altitude values', async ({ page }) => {
    await installAltitudeFixture(page);
    await boot(page, 'he');
    await page.locator('.tb-section[data-sec="charts"] #alt-pairs').click();

    const heads = page.locator('.charts-alt-current-head th');
    await expect(heads.nth(0)).toHaveText('נתיב');
    await expect(heads.nth(1)).toHaveText('כיוון');
    await expect(heads.nth(2)).toHaveText('גובה');
    await expect(heads.nth(3)).toHaveText('כיוון');
    await expect(heads.nth(4)).toHaveText('גובה');
    await expect(heads.nth(5)).toHaveText('סוג');
    await expect(heads.nth(6)).toHaveText('מ״י');

    const directions = page.locator('.charts-alt-direction');
    await expect(directions.nth(0)).toHaveText('AAKKO → AHIUD');
    await expect(directions.nth(1)).toHaveText('AHIUD → AAKKO');
    const bidi = await cssSnapshot(directions.first());
    expect(bidi.direction).toBe('ltr');
    expect(bidi.unicodeBidi).toContain('isolate');
  });

  test('English table uses the same explicit direction layout', async ({ page }) => {
    await installAltitudeFixture(page);
    await boot(page, 'en');
    await page.locator('.tb-section[data-sec="charts"] #alt-pairs').click();

    const heads = page.locator('.charts-alt-current-head th');
    await expect(heads.nth(0)).toHaveText('Pair');
    await expect(heads.nth(1)).toHaveText('Direction');
    await expect(heads.nth(2)).toHaveText('Altitude');
    await expect(heads.nth(3)).toHaveText('Direction');
    await expect(heads.nth(4)).toHaveText('Altitude');
    await expect(heads.nth(5)).toHaveText('Type');
    await expect(heads.nth(6)).toHaveText('NM');

    const directions = page.locator('.charts-alt-direction');
    await expect(directions.nth(0)).toHaveText('AAKKO → AHIUD');
    await expect(directions.nth(1)).toHaveText('AHIUD → AAKKO');
  });
});
