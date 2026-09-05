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

// --- 7. The NOTAM list resizes, and the grip tracks the cursor -------------------
async function dragNotamGrip(page, dx, dy) {
  const g = await page.locator('.notam-grip').boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + dx, g.y + g.height / 2 + dy, { steps: 10 });
  await page.mouse.up();
}

for (const lang of ['en', 'he']) {
  test(`the NOTAM list resizes and the corner follows the cursor (${lang})`, async ({ page }) => {
    await page.setViewportSize(DESK);
    await page.goto('?lang=' + lang);
    await page.waitForFunction(() => !document.getElementById('boot-loading'));
    await page.waitForFunction(() => typeof showNotamModal === 'function');
    await page.evaluate((l) => { window.activeNotams = () => l; showNotamModal(); }, FIR_NOTAMS);
    await expect(page.locator('.notam-modal')).toBeVisible();

    const before = await page.locator('.notam-modal').boundingBox();
    await dragNotamGrip(page, 140, 80);
    const after = await page.locator('.notam-modal').boundingBox();
    // 1:1 with the cursor. Flex centring used to move both edges, so the box grew by only
    // half the drag and the corner slid away from the pointer.
    expect(Math.round(after.width - before.width)).toBeGreaterThan(120);
    // Height grows too, but stops at the 84vh cap that keeps the box on screen -- it opens
    // at 78vh, so there is only ~6vh of headroom to take.
    expect(after.height).toBeGreaterThan(before.height);
    expect(after.height).toBeLessThanOrEqual(Math.round(DESK.height * 0.84) + 1);
    // Top-left pinned, so the gripped edges are the ones that moved.
    expect(Math.round(after.x)).toBe(Math.round(before.x));
    expect(Math.round(after.y)).toBe(Math.round(before.y));
  });
}

test('the resized NOTAM list is remembered', async ({ page }) => {
  await openNotamList(page, FIR_NOTAMS);
  await dragNotamGrip(page, 120, 40);
  const want = Math.round((await page.locator('.notam-modal').boundingBox()).width);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('navaid.notamModalSize')),
    { timeout: 5000 }).toContain('"w"');
  await page.evaluate(() => { document.querySelector('.modal-back[data-chart-modal="notam-list"]').remove(); });
  await page.evaluate((l) => { window.activeNotams = () => l; showNotamModal(); }, FIR_NOTAMS);
  const again = Math.round((await page.locator('.notam-modal').boundingBox()).width);
  expect(Math.abs(again - want)).toBeLessThanOrEqual(2);
});

test('the grip cannot push the list off the screen', async ({ page }) => {
  await openNotamList(page, FIR_NOTAMS);
  await dragNotamGrip(page, 4000, 4000);
  const box = await page.locator('.notam-modal').boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(DESK.width);
  expect(box.y + box.height).toBeLessThanOrEqual(DESK.height);
});

// --- 8. The same data-derived label, in the frequency table ---------------------
// Fixing the inspector left this one: the table still printed "ATIS Arrival" beside a row
// reading "בן גוריון מגדל". Two render paths, one data source.
test('the frequency table translates comm part labels too', async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto('?lang=he');
  await page.waitForFunction(() => !document.getElementById('boot-loading'));
  await page.waitForFunction(() => typeof showFreqTableModal === 'function');
  await page.evaluate(() => showFreqTableModal());
  await expect(page.locator('.charts-freq-label').first()).toBeVisible();
  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.charts-freq-label'), e => e.textContent || ''));
  expect(labels.some(t => t.includes('ATIS'))).toBe(true);
  expect(labels.join(' | ')).not.toMatch(/Arrival|Departure/);
  expect(labels.some(t => t.includes('נחיתה'))).toBe(true);
  expect(labels.some(t => t.includes('המראה'))).toBe(true);
});

test('the frequency search still matches the English label', async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto('?lang=he');
  await page.waitForFunction(() => !document.getElementById('boot-loading'));
  await page.waitForFunction(() => typeof showFreqTableModal === 'function');
  await page.evaluate(() => showFreqTableModal());
  await expect(page.locator('.charts-freq-label').first()).toBeVisible();
  // A pilot typing either spelling has to find the row, so the index keeps both.
  const idx = await page.evaluate(() =>
    Array.from(document.querySelectorAll('tr[data-search]'), e => e.dataset.search).join(' | '));
  expect(idx).toContain('arrival');
  expect(idx).toContain('נחיתה');
});

// --- 9. No raw undefined in a message sent to an airfield -----------------------
test('a parking request with no date of flight never says "undefined"', async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto('?lang=he');
  await page.waitForFunction(() => !document.getElementById('boot-loading'));
  await page.waitForFunction(() => typeof fplParkingText === 'function' && typeof airfieldParkingRule === 'function');
  const out = await page.evaluate(async () => {
    if (airfields === null) await loadAirfields();
    const park = airfieldParkingRule('LLHZ');
    // A plan the pilot has not dated yet: res.dof is simply absent.
    const t = fplParkingText({ dep: 'LLBG', dest: 'LLHZ', reg: '4X-ABC' }, park, {});
    return { subject: t.subject, body: t.body };
  });
  // This text is addressed to an airfield operations desk; a raw JS value in it is not a
  // cosmetic defect.
  expect(out.subject).not.toMatch(/undefined/);
  expect(out.body).not.toMatch(/undefined/);
  // The date line is still present, just blank rather than broken.
  expect(out.body).toMatch(/—/);
});

test('a parking request with a date still shows it', async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto('?lang=he');
  await page.waitForFunction(() => !document.getElementById('boot-loading'));
  await page.waitForFunction(() => typeof fplParkingText === 'function' && typeof airfieldParkingRule === 'function');
  const out = await page.evaluate(async () => {
    if (airfields === null) await loadAirfields();
    const park = airfieldParkingRule('LLHZ');
    const t = fplParkingText({ dep: 'LLBG', dest: 'LLHZ', reg: '4X-ABC', dof: '260902' }, park, {});
    return { subject: t.subject, body: t.body };
  });
  expect(out.subject).toContain('02/09/2026');
  expect(out.body).toContain('02/09/2026');
});

// --- 10. Two defects introduced by the fixes above ------------------------------
test('the date row has no dangling comma when only a departure time is set', async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto('?lang=en');
  await page.waitForFunction(() => !document.getElementById('boot-loading'));
  await page.waitForFunction(() => typeof fplParkingText === 'function' && typeof airfieldParkingRule === 'function');
  const line = await page.evaluate(async () => {
    if (airfields === null) await loadAirfields();
    const park = airfieldParkingRule('LLHZ');
    // Removing "undefined" left the separator behind: "Date of flight:  ,  departure 12:00".
    const t = fplParkingText({ dep: 'LLBG', dest: 'LLHZ', reg: '4X-ABC' }, park, { depTimeLocal: '12:00' });
    return (t.body.split('\n').find(l => /Date of flight/i.test(l)) || '').trim();
  });
  expect(line).not.toMatch(/:\s*,/);
  expect(line).toMatch(/departure 12:00/);
});

test('a NOTAM list pinned by the grip is pulled back when the window shrinks', async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto('?lang=en');
  await page.waitForFunction(() => !document.getElementById('boot-loading'));
  await page.waitForFunction(() => typeof showNotamModal === 'function');
  await page.evaluate((l) => { window.activeNotams = () => l; showNotamModal(); }, FIR_NOTAMS);
  // The state the grip leaves behind: absolutely positioned, sized for a big window.
  await page.evaluate(() => {
    const b = document.querySelector('.notam-modal');
    b.style.position = 'absolute'; b.style.margin = '0';
    b.style.left = '900px'; b.style.top = '600px'; b.style.width = '600px'; b.style.height = '500px';
  });
  await page.setViewportSize({ width: 700, height: 600 });
  await expect.poll(async () => {
    const b = await page.locator('.notam-modal').boundingBox();
    return Math.round(b.x + b.width) <= 700 && Math.round(b.y) < 600;
  }, { timeout: 4000 }).toBe(true);
});

test('closing the NOTAM list releases its window listener', async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto('?lang=en');
  await page.waitForFunction(() => !document.getElementById('boot-loading'));
  await page.waitForFunction(() => typeof showNotamModal === 'function');
  const leaked = await page.evaluate((l) => {
    window.activeNotams = () => l;
    let n = 0;
    const add = window.addEventListener.bind(window);
    const rm = window.removeEventListener.bind(window);
    window.addEventListener = (t, f, o) => { if (t === 'resize') n++; return add(t, f, o); };
    window.removeEventListener = (t, f, o) => { if (t === 'resize') n--; return rm(t, f, o); };
    for (let i = 0; i < 3; i++) {
      showNotamModal();
      document.querySelector('.modal-back[data-chart-modal="notam-list"]')._navaidClose();
    }
    return n;
  }, FIR_NOTAMS);
  // Bound to window, so it outlives the modal unless the teardown takes it off.
  expect(leaked).toBe(0);
});

// --- 11. A re-render must not stack window listeners ----------------------------
test('the frequency table does not stack a resize listener per re-render', async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto('?lang=en');
  await page.waitForFunction(() => !document.getElementById('boot-loading'));
  await page.waitForFunction(() => typeof showFreqTableModal === 'function');
  const r = await page.evaluate(async () => {
    let n = 0;
    const add = window.addEventListener.bind(window);
    const rm = window.removeEventListener.bind(window);
    window.addEventListener = (t, f, o) => { if (t === 'resize') n++; return add(t, f, o); };
    window.removeEventListener = (t, f, o) => { if (t === 'resize') n--; return rm(t, f, o); };
    showFreqTableModal();
    await new Promise(res => setTimeout(res, 800));      // catalog load, then first render
    const afterOpen = n;
    // Restoring defaults rebuilds the table in place; it used to add a listener each pass,
    // every one holding the detached tableWrap it closed over.
    const sec = document.querySelector('.charts-freq-section');
    for (let i = 0; i < 3; i++) renderFreqTable(sec);
    const afterRenders = n;
    const back = document.querySelector('.modal-back[data-chart-modal="freq-table"]');
    if (back && back._navaidClose) back._navaidClose();
    return { afterOpen, afterRenders, afterClose: n };
  });
  expect(r.afterOpen).toBe(1);
  expect(r.afterRenders).toBe(1);      // was 4: one per render, none removed
  expect(r.afterClose).toBe(0);        // and the last one goes when the modal does
});
