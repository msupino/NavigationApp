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
