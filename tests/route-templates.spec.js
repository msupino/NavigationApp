// @ts-check
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const TEMPLATES_PATH = path.join(__dirname, '..', 'docs', 'route-templates.json');
const AIRFIELDS_PATH = path.join(__dirname, '..', 'docs', 'airfields.json');
const NAV_WP_PATH = path.join(__dirname, '..', 'docs', 'nav-waypoints.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function routeAltitudeOk(value) {
  return value === null || value === 'NaN' ||
    (typeof value === 'number' && Number.isFinite(value));
}

async function boot(page, lang = 'en') {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print']) {
        localStorage.setItem('navaid.sec.' + s, '1');
      }
    } catch (e) {}
  });
  await page.goto('?lang=' + lang);
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    typeof showRouteTemplatesModal === 'function');
}

test.describe('route templates', () => {
  test('dataset templates reference known points and complete leg lists', async () => {
    const data = readJson(TEMPLATES_PATH);
    const airfields = readJson(AIRFIELDS_PATH).airfields;
    const navWp = readJson(NAV_WP_PATH).waypoints;
    const known = new Set([
      ...airfields.map(p => p.name),
      ...navWp.map(p => p.name),
    ]);
    expect(data.version).toBe(1);
    expect(Array.isArray(data.templates)).toBe(true);
    expect(data.templates.length).toBeGreaterThan(0);
    for (const template of data.templates) {
      expect(typeof template.id).toBe('string');
      expect(typeof template.name).toBe('string');
      expect(Number.isFinite(template.defaultSpeed)).toBe(true);
      expect(template.defaultSpeed).toBeGreaterThan(0);
      expect(template.waypoints.length).toBeGreaterThan(1);
      expect(template.legs.length).toBe(template.waypoints.length - 1);
      for (const code of template.waypoints) expect(known.has(code)).toBe(true);
      for (const leg of template.legs) {
        expect(routeAltitudeOk(leg.inboundAltitude)).toBe(true);
        expect(routeAltitudeOk(leg.outboundAltitude)).toBe(true);
      }
    }
  });

  test('user selects a speed and builds the Herzliya to Haifa route', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.tb-section[data-sec="build"] #route-templates')).toHaveCount(0);
    const button = page.locator('.tb-section[data-sec="charts"] #route-templates');
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.locator('.route-template-modal')).toBeVisible();
    await expect(page.locator('.route-template-select')).toHaveValue('llhz-llha-coastal');
    await expect(page.locator('.route-template-speed')).toHaveValue('90');
    await page.locator('.route-template-speed').fill('115');
    await page.locator('.route-template-modal button', { hasText: 'Build route' }).click();
    await expect(page.locator('.route-template-modal')).toHaveCount(0);
    const route = await page.evaluate(() => ({
      waypoints: state.waypoints.map(w => w.name),
      speeds: state.legs.map(l => [l.flightSpeed, l.outboundSpeed]),
      alts: state.legs.map(l => [l.inboundAltitude, l.outboundAltitude]),
      notes: state.notes.map(n => ({ cc: n.cc || '', freqName: n.freqName || '', freq: n.freq || '' })),
    }));
    expect(route.waypoints).toEqual([
      'LLHZ', 'BAZRA', 'DEROR', 'SHARO', 'HADRA', 'FRDIS',
      'BOREN', 'HOTRM', 'DAROM', 'GALIM', 'LLHA',
    ]);
    expect(route.speeds.every(([a, b]) => a === 115 && b === 115)).toBe(true);
    expect(route.alts[0]).toEqual([800, 1200]);
    expect(route.alts[6]).toEqual([1500, 1000]);
    expect(route.notes).toEqual(expect.arrayContaining([
      { cc: 'DEROR', freqName: 'PLUTO_WEST', freq: '118.40' },
      { cc: 'DAROM', freqName: 'HAIFA', freq: '133.00' },
    ]));
  });
});
