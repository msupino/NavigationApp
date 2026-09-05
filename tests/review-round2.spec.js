// @ts-check
// Four findings from a review of origin/main. Each test fails without its fix.
const { test, expect } = require('./_setup');

const DESK = { width: 1280, height: 900 };

// LLBG carries a METAR with a temperature and the only labelled comm parts in the dataset.
const METAR = {
  icaoId: 'LLBG', rawOb: 'LLBG 051620Z 32005KT 9999 SCT029 28/21 Q1011',
  wdir: 320, wspd: 5, visib: '10+', temp: 28, dewp: 21, altim: 1011, clouds: [],
};

async function mockWx(page, extra) {
  await page.route('**wx-data/wx.json**', r => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: 'IAA (brin.iaa.gov.il MobileAeroinfo)',
      stations: { LLBG: { metar: Object.assign({}, METAR, extra || {}) } },
    }),
  }));
}

async function openLLBG(page, lang = 'en') {
  await page.setViewportSize(DESK);
  await page.goto('?lang=' + lang);
  await page.waitForFunction(() => !document.getElementById('boot-loading'));
  await page.waitForFunction(() => typeof showInspector === 'function' && typeof state !== 'undefined');
  await page.evaluate(async () => {
    if (airfields === null) await loadAirfields();
    state.selected = { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLBG') };
    showInspector();
  });
  await expect(page.locator('#inspector')).toBeVisible();
}

// --- 1. Density altitude must use the METAR the panel is showing -----------------
// The observation branch was gated on `metar.obsTime`, an AWC field. The IAA feed has been
// primary since the source switch and builds its METAR objects from scratch, so nothing
// produced obsTime and the gate was dead: density altitude fell through to the forecast, or
// said "no temperature available" directly above a live 28°C observation.
test('density altitude uses a METAR that carries no obsTime', async ({ page }) => {
  // Exactly what the live feed looks like: `created`, no `obsTime`.
  await mockWx(page, { created: new Date(Date.now() - 5 * 60e3).toISOString() });
  await openLLBG(page);
  const src = page.locator('.da-src-row .val');
  await expect(src).not.toHaveText(/no temperature available/i);
  await expect(src).toContainText(/METAR/i);
});

test('a stale METAR is still refused rather than presented as now', async ({ page }) => {
  // The gate exists for a reason: a station that stopped reporting must not keep feeding
  // "now" into a performance figure. Six hours old is past any sane threshold.
  await mockWx(page, { created: new Date(Date.now() - 6 * 3600e3).toISOString() });
  await openLLBG(page);
  await expect(page.locator('.da-src-row .val')).not.toContainText(/^METAR/i);
});

// --- 2. Saved Routes must open with site data blocked ---------------------------
test('the route library opens when localStorage throws', async ({ page }) => {
  await page.addInitScript(() => {
    const boom = () => { throw new Error('The operation is insecure.'); };
    Object.defineProperty(window, 'localStorage', { get: boom, configurable: true });
  });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof showRouteLibraryModal === 'function');
  const r = await page.evaluate(() => {
    const t = (fn) => { try { fn(); return 'ok'; } catch (e) { return 'THREW: ' + e.message; } };
    return {
      load: t(() => loadRouteLibrary()),
      modal: t(() => showRouteLibraryModal()),
      // Blocked storage is not damaged data: flagging it corrupt would tell the pilot their
      // saved routes are broken and block writes to protect them.
      corrupt: NavAid.routeLibraryCorrupt === true,
    };
  });
  expect(r.load).toBe('ok');
  expect(r.modal).toBe('ok');
  expect(r.corrupt).toBe(false);
});

// --- 3. Comm part labels are data, so no string scan can catch them --------------
test('ATIS Arrival/Departure are translated in a Hebrew session', async ({ page }) => {
  await openLLBG(page, 'he');
  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#insp-body .atis-row'), e => e.textContent || '').join(' | '));
  expect(labels).toContain('נחיתה');
  expect(labels).toContain('המראה');
  expect(labels).not.toMatch(/Arrival|Departure/);
});

test('an unknown part label degrades to English instead of vanishing', async ({ page }) => {
  await openLLBG(page, 'he');
  // Only Arrival and Departure appear in the dataset today; anything new must still render.
  expect(await page.evaluate(() => commPartLabel('Ground'))).toBe('Ground');
  expect(await page.evaluate(() => commPartLabel(''))).toBe('');
});

// --- 4. A clipped title must still be readable ----------------------------------
test('a long inspector title carries the full text as a tooltip', async ({ page }) => {
  await openLLBG(page);
  const el = page.locator('#insp-title');
  const value = await el.inputValue();
  expect(value.length).toBeGreaterThan(10);
  // The header is narrow and the name is cut; the tooltip is what makes it recoverable.
  expect(await el.getAttribute('title')).toBe(value);
  expect(await el.evaluate(e => getComputedStyle(e).textOverflow)).toBe('ellipsis');
});

test('the tooltip follows a later title change', async ({ page }) => {
  await openLLBG(page);
  // Assignments happen from a dozen places; the tooltip is wired to the property so a call
  // site added later cannot forget it.
  await page.evaluate(() => { document.getElementById('insp-title').value = 'Some Other Field'; });
  expect(await page.locator('#insp-title').getAttribute('title')).toBe('Some Other Field');
});

// --- 5. An obstacle is not a frequency ------------------------------------------
// "DRILLING TOWER ERECTED WI LLBG CTR" matched \bTOWER\b and badged Ben Gurion with a
// frequency NOTAM about a drilling rig. TOWER is the one term in that alternation that is
// also a physical thing, so the exclusion is decided on the Q-code subject the feed states.
const NOTAMS = [
  { id: 'A0720/26', icao: 'LLBG', type: 'OBCE',
    text: 'DRILLING TOWER ERECTED WI LLBG CTR, AT YAHUD/IAI INDUSTRY. LIT AND DAY MARKED.',
    start: '2026-09-02T14:24:00Z', end: '2036-12-31T23:59:00Z' },
  { id: 'A0685/26', icao: 'LLBG', type: 'CACS',
    text: 'NEW FREQ INSTL FOR CLEARANCE BFR TAXI (CPT) 121.800MHZ.',
    start: '2026-09-02T14:24:00Z', end: '2036-12-31T23:59:00Z' },
];

test('an obstacle NOTAM is not treated as a frequency NOTAM', async ({ page }) => {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof airfieldFreqNotams === 'function');
  const ids = await page.evaluate((list) => {
    window.activeNotams = () => list;
    return airfieldFreqNotams('LLBG').map(n => n.id);
  }, NOTAMS);
  // The drilling rig is out; the genuine clearance-frequency NOTAM stays in.
  expect(ids).not.toContain('A0720/26');
  expect(ids).toContain('A0685/26');
});

test('the loose match is still loose for everything that is not an obstacle', async ({ page }) => {
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof airfieldFreqNotams === 'function');
  // Under-inclusion loses a comms requirement, which costs more than an extra read, so
  // "requires radio" area NOTAMs and withdrawn navaid frequencies must keep matching.
  const kept = await page.evaluate(() => {
    const probe = [
      { icao: 'LLXX', type: 'ACLP', text: 'GLD ACT. PILOT SHALL MAKE TWO WAY RADIO COM WITH ATC.' },
      { icao: 'LLXX', type: 'NMAS', text: 'VOR/DME RAM FREQ 113.850MHZ WITHDRAWN FOR MAINT.' },
      { icao: 'LLXX', type: 'OBCE', text: 'CRANE ERECTED. TOWER LIT AND DAY MARKED.' },
    ];
    window.activeNotams = () => probe;
    return airfieldFreqNotams('LLXX').map(n => n.type);
  });
  expect(kept).toEqual(['ACLP', 'NMAS']);
});

// --- 6. The NOTAM list has to say how much there is, and whose it is -------------
const FIR_NOTAMS = Array.from({ length: 25 }, (_, i) => ({
  id: 'A' + String(700 + i) + '/26',
  icao: i % 2 ? 'LLBG' : 'LLHA',
  type: 'CACS',
  text: 'TEST NOTAM ' + i + ' TEL AVIV CONTROL FREQ 123.050MHZ NOT AVBL.',
  start: '2026-09-02T00:00:00Z', end: '2036-12-31T23:59:00Z',
}));

async function openNotamList(page, list) {
  await page.setViewportSize(DESK);
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof showNotamModal === 'function');
  await page.evaluate((l) => { window.activeNotams = () => l; showNotamModal(); }, list);
  await expect(page.locator('.notam-modal')).toBeVisible();
}

test('every card names the airfield it belongs to', async ({ page }) => {
  await openNotamList(page, FIR_NOTAMS);
  const ids = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.notam-id'), e => e.textContent || ''));
  expect(ids.length).toBeGreaterThan(0);
  // The FIR view mixes airfields under one (LLLL) header; without this every card looked
  // alike and there was nothing saying which field a NOTAM was actually about.
  expect(ids.every(t => /LL[A-Z]{2}/.test(t))).toBe(true);
  expect(ids.some(t => t.includes('LLBG'))).toBe(true);
  expect(ids.some(t => t.includes('LLHA'))).toBe(true);
});

test('a long list opens tall and says there is more below', async ({ page }) => {
  await openNotamList(page, FIR_NOTAMS);
  const box = await page.locator('.notam-modal').boundingBox();
  // Opening at content height made a 52-entry list look like a two-entry one.
  expect(box.height).toBeGreaterThan(DESK.height * 0.5);
  const list = page.locator('.notam-list');
  await expect(list).toHaveClass(/notam-list-more/);
});

test('the "more below" fade goes away at the end of the list', async ({ page }) => {
  await openNotamList(page, FIR_NOTAMS);
  const list = page.locator('.notam-list');
  await expect(list).toHaveClass(/notam-list-more/);
  await list.evaluate(e => { e.scrollTop = e.scrollHeight; });
  // A fade that stayed on at the bottom would claim content that is not there.
  await expect(list).not.toHaveClass(/notam-list-more/);
});

test('a short list never claims there is more', async ({ page }) => {
  await openNotamList(page, FIR_NOTAMS.slice(0, 2));
  await expect(page.locator('.notam-list')).not.toHaveClass(/notam-list-more/);
});
