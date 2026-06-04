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

function routeSnapshotScript() {
  return {
    waypoints: state.waypoints.map(w => w.name),
    speeds: state.legs.map(l => [l.flightSpeed, l.outboundSpeed]),
    alts: state.legs.map(l => [
      Number.isNaN(l.inboundAltitude) ? 'NaN' : l.inboundAltitude,
      Number.isNaN(l.outboundAltitude) ? 'NaN' : l.outboundAltitude,
    ]),
    notes: state.notes.map(n => ({
      cc: n.cc || '',
      freqName: n.freqName || '',
      freq: n.freq || '',
    })),
  };
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
    expect(data.templates.map(template => template.id)).toEqual(expect.arrayContaining([
      'llhz-llha-coastal',
      'llha-llhz-coastal',
      'llhz-llmz-dead-sea',
      'llhz-llbs-south',
      'llmz-llhz-dead-sea',
    ]));
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
    const route = await page.evaluate(routeSnapshotScript);
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

  for (const templateCase of [
    {
      id: 'llha-llhz-coastal',
      name: 'Haifa to Herzliya',
      waypoints: [
        'LLHA', 'GALIM', 'DAROM', 'HOTRM', 'BOREN', 'FRDIS',
        'HADRA', 'SHARO', 'DEROR', 'BAZRA', 'LLHZ',
      ],
      alts: {
        0: [2000, 1500],
        3: [1000, 1500],
        8: [2000, 800],
        9: [1200, 800],
      },
      notes: [
        { cc: 'DAROM', freqName: 'PLUTO_WEST', freq: '118.40' },
        { cc: 'DEROR', freqName: 'HERZLIYA', freq: '122.20' },
      ],
    },
    {
      id: 'llhz-llmz-dead-sea',
      name: 'Herzliya to Masada',
      waypoints: ['LLHZ', 'SFAIM', 'RIDNG', 'CLORE', 'TYONA', 'NTAIM', 'SIRNI',
        'NSHRM', 'AYLON', 'LTRUN', 'SHARG', 'SORES', 'HAREL', 'HNINA', 'ANATA',
        'DUMIM', 'YRIHO', 'ALMOG', 'ZUKIM', 'SHALM', 'ENGDI', 'LLMZ'],
      alts: {
        0: [1200, 'NaN'],
        14: [4500, 5000],
        15: [3500, 4000],
        16: [3500, 4000],
        20: [3500, 4000],
      },
      notes: [
        { cc: 'SFAIM', freqName: 'PLUTO_WEST', freq: '118.40' },
        { cc: 'LLMZ', freqName: 'MASADA', freq: '122.55' },
      ],
    },
    {
      id: 'llhz-llbs-south',
      name: 'Herzliya to Teyman',
      waypoints: ['LLHZ', 'SFAIM', 'HTZUK', 'RIDNG', 'CLORE', 'TYONA', 'NTAIM',
        'BOVED', 'NAGID', 'YAVNE', 'ZASHD', 'NMASD', 'NITZA', 'HODYA', 'REVAH',
        'NOAAM', 'BKAMA', 'SOVAL', 'MINGV', 'NASIH', 'LLBS'],
      alts: {
        0: [1200, 'NaN'],
        6: [1200, 800],
        12: [2000, 2500],
        17: [2500, 'NaN'],
        19: [2000, 3000],
      },
      notes: [
        { cc: 'SFAIM', freqName: 'PLUTO_WEST', freq: '118.40' },
        { cc: 'LLBS', freqName: 'TEYMAN', freq: '122.50' },
      ],
    },
    {
      id: 'llmz-llhz-dead-sea',
      name: 'Masada to Herzliya',
      waypoints: ['LLMZ', 'ENGDI', 'SHALM', 'ZUKIM', 'ALMOG', 'YRIHO', 'DUMIM',
        'ANATA', 'HNINA', 'HAREL', 'SORES', 'SHARG', 'LTRUN', 'AYLON', 'NSHRM',
        'SIRNI', 'NTAIM', 'TYONA', 'CLORE', 'RIDNG', 'HTZUK', 'KNTRY', 'LLHZ'],
      alts: {
        0: [4000, 3500],
        4: [4000, 3500],
        5: [4000, 3500],
        6: [5000, 4500],
        21: [1200, 'NaN'],
      },
      notes: [
        { cc: 'LLMZ', freqName: 'MASADA', freq: '122.55' },
        { cc: 'KNTRY', freqName: 'HERZLIYA', freq: '122.20' },
      ],
    },
  ]) {
    test(`user builds the ${templateCase.name} route template`, async ({ page }) => {
      await boot(page);
      await page.locator('#route-templates').click();
      await page.locator('.route-template-select').selectOption(templateCase.id);
      await page.locator('.route-template-speed').fill('105');
      await page.locator('.route-template-modal button', { hasText: 'Build route' }).click();
      await expect(page.locator('.route-template-modal')).toHaveCount(0);

      const route = await page.evaluate(routeSnapshotScript);

      expect(route.waypoints).toEqual(templateCase.waypoints);
      expect(route.speeds.every(([a, b]) => a === 105 && b === 105)).toBe(true);
      for (const [index, alts] of Object.entries(templateCase.alts)) {
        expect(route.alts[Number(index)]).toEqual(alts);
      }
      expect(route.notes).toEqual(expect.arrayContaining(templateCase.notes));
    });
  }
});
