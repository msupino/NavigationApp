// @ts-check
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const TEMPLATES_PATH = path.join(__dirname, '..', 'docs', 'data', 'route-templates.json');
const AIRFIELDS_PATH = path.join(__dirname, '..', 'docs', 'data', 'airfields.json');
const NAV_WP_PATH = path.join(__dirname, '..', 'docs', 'data', 'cvfr-nav-waypoints.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function routeSnapshotScript() {
  return {
    waypoints: state.waypoints.map(w => w.name),
    speeds: state.legs.map(l => [l.flightSpeed, l.outboundSpeed]),
    auto: state.legs.map(l => l._legAltitudeAuto === 1),
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
  test('templates carry NO altitude data (altitudes come from cvfr-leg-altitude.json)', async () => {
    const data = readJson(TEMPLATES_PATH);
    for (const t of data.templates) {
      // No leg/altitude fields at the template level.
      expect(t).not.toHaveProperty('legs');
      expect(t).not.toHaveProperty('inboundAltitude');
      expect(t).not.toHaveProperty('outboundAltitude');
      // ...nor nested in any leg-like array, just in case.
      for (const leg of (t.legs || [])) {
        expect(leg).not.toHaveProperty('inboundAltitude');
        expect(leg).not.toHaveProperty('outboundAltitude');
      }
    }
  });

  test('templates are listed alphabetically by name in the modal', async ({ page }) => {
    await boot(page);
    await page.locator('.tb-section[data-sec="charts"] #route-templates').click();
    await expect(page.locator('.route-template-modal')).toBeVisible();
    const names = await page.locator('.route-template-select option').allTextContents();
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  test('loading a CVFR template on a non-matching layer warns instead of loading', async ({ page }) => {
    await boot(page);
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
    const r = await page.evaluate(async () => {
      const all = await loadRouteTemplates();
      const tpl = all.find(t => t.layer === 'cvfr') || all[0];
      const setL = k => { for (const n in layers) if (map.hasLayer(layers[n])) map.removeLayer(layers[n]); map.addLayer(layers[k]); };
      // matching layer (CVFR) loads
      setL('CVFR');
      const okCvfr = await applyRouteTemplate(tpl, 90, null);
      // wrong layer (Low Alt) is blocked
      setL('Low Alt');
      const okLsa = await applyRouteTemplate(tpl, 90, null);
      return { okCvfr, okLsa, tplName: tpl.name };
    });
    expect(r.okCvfr).toBe(true);     // loads on its own layer
    expect(r.okLsa).toBe(false);     // blocked on Low Alt
    expect(dialogs.some(m => /Low Alt/.test(m) && new RegExp(r.tplName).test(m))).toBe(true);
  });

  test('dataset templates reference known points and keep altitude data shared', async () => {
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
      'llhz-llib-north',
      'llib-llhz-north',
      'llhz-llmz-dead-sea',
      'llhz-llbs-south',
      'llbs-llhz-south',
      'llmz-llhz-dead-sea',
    ]));
    for (const template of data.templates) {
      expect(typeof template.id).toBe('string');
      expect(typeof template.name).toBe('string');
      expect(Number.isFinite(template.defaultSpeed)).toBe(true);
      expect(template.defaultSpeed).toBeGreaterThan(0);
      expect(template.waypoints.length).toBeGreaterThan(1);
      expect(Object.prototype.hasOwnProperty.call(template, 'legs')).toBe(false);
      for (const code of template.waypoints) expect(known.has(code)).toBe(true);
      for (const note of (template.notes || [])) {
        expect(note).not.toHaveProperty('lat');
        expect(note).not.toHaveProperty('lng');
        expect(note).not.toHaveProperty('freq');
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
    // Templates are listed alphabetically by name, so select explicitly.
    await page.locator('.route-template-select').selectOption('llhz-llha-coastal');
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
    expect(route.auto.every(Boolean)).toBe(true);
    expect(route.alts[0]).toEqual([800, 1200]);
    expect(route.alts[6]).toEqual([1500, 2000]);
    expect(route.notes).toEqual(expect.arrayContaining([
      { cc: 'DEROR', freqName: 'PLUTO_WEST', freq: '118.40' },
      { cc: 'DAROM', freqName: 'HAIFA', freq: '133.00' },
    ]));
  });

  for (const templateCase of [
    {
      id: 'llib-llha-north',
      name: 'Rosh Pina to Haifa',
      waypoints: [
        'LLIB', 'AMNON', 'DESHE', 'ZALMN', 'SEGEV', 'EVLYM', 'GILAM', 'LLHA',
      ],
      alts: {},
      notes: [
        { cc: 'DESHE', freqName: 'PLUTO_EAST', freq: '123.85' },
        { cc: 'GILAM', freqName: 'HAIFA', freq: '133.00' },
      ],
    },
    {
      id: 'llha-llib-valley',
      name: 'Haifa to Rosh Pina (via the valleys)',
      waypoints: [
        'LLHA', 'GALIM', 'DAROM', 'HOTRM', 'BOREN', 'FRDIS', 'HADRA',
        'EIRON', 'ZMGID', 'AFULA', 'TAVOR', 'DESHE', 'AMNON', 'LLIB',
      ],
      alts: {},
      notes: [
        { cc: 'DAROM', freqName: 'PLUTO_WEST', freq: '118.40' },
        { cc: 'AFULA', freqName: 'PLUTO_EAST', freq: '123.85' },
        { cc: 'DESHE', freqName: 'ROSH_PINA', freq: '118.45' },
      ],
    },
    {
      id: 'llha-llib-north',
      name: 'Haifa to Rosh Pina',
      waypoints: [
        'LLHA', 'GILAM', 'EVLYM', 'SEGEV', 'ZALMN', 'DESHE', 'AMNON', 'LLIB',
      ],
      alts: {},   // whatever the CVFR altitude table applies — pinned by other tests
      notes: [
        { cc: 'GILAM', freqName: 'PLUTO_EAST', freq: '123.85' },
        { cc: 'DESHE', freqName: 'ROSH_PINA', freq: '118.45' },
      ],
    },
    {
      id: 'llhz-llib-north',
      name: 'Herzliya to Rosh Pina',
      waypoints: [
        'LLHZ', 'BAZRA', 'DEROR', 'SHARO', 'HADRA', 'EIRON',
        'ZMGID', 'AFULA', 'TAVOR', 'DESHE', 'AMNON', 'LLIB',
      ],
      alts: {
        0: [800, 1200],
        1: [800, 2000],
        2: [1500, 2000],
        4: [2500, 3000],
        7: [2500, 3000],
        10: [2500, 3000],
      },
      notes: [
        { cc: 'DEROR', freqName: 'PLUTO_WEST', freq: '118.40' },
        { cc: 'ZMGID', freqName: 'PLUTO_EAST', freq: '123.85' },
        { cc: 'DESHE', freqName: 'ROSH_PINA', freq: '118.45' },
      ],
    },
    {
      id: 'llib-llhz-north',
      name: 'Rosh Pina to Herzliya',
      waypoints: [
        'LLIB', 'AMNON', 'DESHE', 'TAVOR', 'AFULA', 'ZMGID',
        'EIRON', 'HADRA', 'SHARO', 'DEROR', 'BAZRA', 'LLHZ',
      ],
      alts: {
        0: [3000, 2500],
        4: [3000, 2500],
        7: [2000, 1500],
        9: [2000, 800],
        10: [1200, 800],
      },
      notes: [
        { cc: 'DEROR', freqName: 'HERZLIYA', freq: '125.60' },
        { cc: 'ZMGID', freqName: 'PLUTO_WEST', freq: '118.40' },
        { cc: 'DESHE', freqName: 'PLUTO_EAST', freq: '123.85' },
      ],
    },
    {
      id: 'llha-llhz-coastal',
      name: 'Haifa to Herzliya',
      waypoints: [
        'LLHA', 'GALIM', 'DAROM', 'HOTRM', 'BOREN', 'FRDIS',
        'HADRA', 'SHARO', 'DEROR', 'BAZRA', 'LLHZ',
      ],
      alts: {
        0: [2000, 1500],
        3: [2000, 1500],
        8: [2000, 800],
        9: [1200, 800],
      },
      notes: [
        { cc: 'DAROM', freqName: 'PLUTO_WEST', freq: '118.40' },
        { cc: 'DEROR', freqName: 'HERZLIYA', freq: '125.60' },
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
        1: [800, 1600],
        4: [800, 1200],
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
        1: [800, 1600],
        6: [800, 1200],
        12: [1500, 2000],
        17: [2500, 3000],
        19: [2000, 3000],
      },
      notes: [
        { cc: 'SFAIM', freqName: 'PLUTO_WEST', freq: '118.40' },
        { cc: 'LLBS', freqName: 'TEYMAN', freq: '122.50' },
      ],
    },
    {
      id: 'llbs-llhz-south',
      name: 'Teyman to Herzliya',
      waypoints: ['LLBS', 'NASIH', 'MINGV', 'SOVAL', 'BKAMA', 'NOAAM', 'REVAH',
        'HODYA', 'NITZA', 'NMASD', 'ZASHD', 'YAVNE', 'NAGID', 'BOVED', 'NTAIM',
        'TYONA', 'CLORE', 'RIDNG', 'HTZUK', 'KNTRY', 'LLHZ'],
      alts: {
        0: [3000, 2000],
        2: [3000, 2500],
        6: [2000, 1500],
        7: [2000, 1500],
        13: [1200, 800],
        17: [1200, 800],
        19: [1200, 'NaN'],
      },
      notes: [
        { cc: 'LLBS', freqName: 'TEYMAN', freq: '122.50' },
        { cc: 'KNTRY', freqName: 'HERZLIYA', freq: '125.60' },
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
        19: [1200, 800],
        21: [1200, 'NaN'],
      },
      notes: [
        { cc: 'LLMZ', freqName: 'MASADA', freq: '122.55' },
        { cc: 'KNTRY', freqName: 'HERZLIYA', freq: '125.60' },
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
      expect(route.auto.every(Boolean)).toBe(true);
      for (const [index, alts] of Object.entries(templateCase.alts)) {
        expect(route.alts[Number(index)]).toEqual(alts);
      }
      expect(route.notes).toEqual(expect.arrayContaining(templateCase.notes));
    });
  }
});
