// @ts-check
// UI review, batch 4 (words): in a Hebrew session no control label / aria-label / title is
// left in English, and nothing that is an icon is an emoji (drawn NAV_ICONS instead).
const { test, expect } = require('./_setup');

const EMOJI = /\p{Extended_Pictographic}/u;

const LATIN_WORD = /\b(?=[A-Za-z]*[a-z])[A-Za-z]{3,}\b/;   // a lower-case word: acronyms (UTC, JSON, GPX) are not English
const noUtc = (v) => v.replace(/UTC/g, '');

async function boot(page, lang) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('?lang=' + (lang || 'he') + '&nogist');
  await page.waitForFunction(() => window.NavAid && typeof createDraggableModal === 'function' && typeof clearBootLoading === 'function');
  await page.evaluate(() => { clearBootLoading(); document.getElementById('map-tour')?.remove(); });
}

test('Hebrew: map chrome carries no English label and no emoji', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    const read = (sel) => [...document.querySelectorAll(sel)].map(e => ({
      sel, title: e.getAttribute('title') || '', aria: e.getAttribute('aria-label') || '',
      ph: e.getAttribute('placeholder') || '' }));
    return [].concat(read('.leaflet-control-zoom-in'), read('.leaflet-control-zoom-out'), read('#zulu-clock'),
      read('#sim-modal-close'), read('#search-close'), read('#search-clear'), read('#wp-search'), read('#export-select'));
  });
  expect(got.length).toBeGreaterThanOrEqual(8);
  for (const g of got) {
    // The search box's own title is its hint (example route codes), not a control label.
    for (const v of [g.sel === '#wp-search' ? '' : g.title, g.aria, g.ph]) {
      expect(noUtc(v), g.sel).not.toMatch(LATIN_WORD);
      expect(v, g.sel).not.toMatch(EMOJI);
    }
  }
  // Each of them does have an accessible name.
  for (const g of got) if (g.sel !== '#wp-search' && g.sel !== '#export-select') expect(g.aria, g.sel).not.toBe('');
});

test('Hebrew: window titles and the pin show drawn icons, not emoji', async ({ page }) => {
  await boot(page);
  for (const fn of ['showFreqTableModal', 'showAltitudePairsModal']) {
    await page.evaluate((f) => window[f] ? window[f]() : eval(f + '()'), fn);
    const t = page.locator('.modal-back .modal-title').last();
    await expect(t).toBeVisible();
    const text = await t.textContent();
    expect(text).not.toMatch(EMOJI);
    await expect(t.locator('.mi-icon svg')).toHaveCount(1);
    await page.evaluate(() => document.querySelectorAll('.modal-back').forEach(b => b._navaidClose && b._navaidClose()));
  }
  await page.evaluate(() => showAltitudePairsModal());
  const pin = page.locator('.charts-alt-pin');
  await expect(pin).toBeVisible();
  expect(await pin.textContent()).not.toMatch(EMOJI);
  await expect(pin.locator('svg')).toHaveCount(1);
});

test('Hebrew: share and new-link windows, route-check marks, simulator status, FPL warning', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => showCopyText(S.tbShare, 'https://example.test/x'));
  const t = page.locator('.modal-back .modal-title').last();
  expect(await t.textContent()).not.toMatch(EMOJI);
  await page.evaluate(() => document.querySelectorAll('.modal-back').forEach(b => b._navaidClose && b._navaidClose()));

  await page.evaluate(async () => {
    const list = await (await fetch('data/route-templates.json')).json();
    await applyRouteTemplate((Array.isArray(list) ? list : list.templates).find(x => x.id === 'llmg-llib-north'), 90, false);
    const now = Date.now();
    const f = (severity) => ({ kind: 'notam', severity, leg: 0, id: 'A1/26', text: 'Crane', from: now, to: now + 6e5 });
    NavAid.routeCheck.show({ result: { from: now, to: now + 1e6, findings: [f('stop'), f('warn')], unchecked: [], partial: [], weatherReports: [], asked: {} } });
  });
  const marks = page.locator('.route-check-mark');
  await expect(marks.first()).toBeAttached();
  for (const m of await marks.all()) {
    expect(await m.textContent()).not.toMatch(EMOJI);
    await expect(m.locator('svg')).toHaveCount(1);
  }

  const status = await page.evaluate(() => {
    const el = document.createElement('div'); window._simStatusEl = el;
    _simSetStatus(true); const ok = el.textContent;
    _simSetStatus(false); return [ok, el.textContent];
  });
  for (const s of status) expect(s).not.toMatch(EMOJI);

  const fpl = await page.evaluate(() => {
    const d = document.createElement('div'); fplSetBidiText(d, '⚠ ' + S.fplAckRequired);
    return { text: d.textContent, svg: d.querySelectorAll('svg').length };
  });
  expect(fpl.text).not.toMatch(EMOJI);
  expect(fpl.svg).toBe(1);
});

test('Hebrew: airspace hours and the traffic unit are not English', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => ({
    h: airspaceHoursText('Sun 04:00 (UTCW) - Thu 19:00 (UTCW)'),
    sr: airspaceHoursText('Mon SR - Mon SS'),
    kt: S.unitKt,
    reports: [S.reportingMandatory, S.reportingOnRequest].map(window.navPlainLabel),
  }));
  expect(noUtc(r.h)).not.toMatch(LATIN_WORD);
  expect(r.sr).not.toMatch(LATIN_WORD);
  expect(r.kt).not.toMatch(/kt/);
  for (const v of r.reports) expect(v).not.toMatch(EMOJI);
});

test('English: the same hours keep their English words', async ({ page }) => {
  await boot(page, 'en');
  const h = await page.evaluate(() => airspaceHoursText('Sun 04:00 (UTCW) - Thu 19:00 (UTCW)'));
  expect(h).toBe('Sun 04:00 (UTCW) - Thu 19:00 (UTCW)');
});

test('copy: search placeholder has no emoji; Tap on a touch screen; tour names Fit; Hebrew plural imperative', async ({ page }) => {
  await boot(page, 'en');
  const en = await page.evaluate(() => ({ ph: document.getElementById('wp-search').placeholder, aria: document.getElementById('export-select').getAttribute('aria-label'),
    tour: S.tourEditText, ask: S.followMeAskCode, touch: S.emptyRouteHintTouch }));
  expect(en.ph).not.toMatch(EMOJI);
  expect(en.aria).not.toMatch(EMOJI);
  expect(en.tour).not.toContain('[ ]');
  expect(en.ask).toMatch(/\(4X-CDE\)\./);
  expect(en.touch).toMatch(/^Tap /);

  await boot(page, 'he');
  const he = await page.evaluate(() => ({ lock: S.editLockOn + S.editLockOff + S.editLockAuto, tour: S.tourEditText, ask: S.followMeAskCode }));
  expect(he.lock).not.toMatch(/הקש(?!י)/);
  expect(he.tour).not.toContain('[ ]');
  expect(he.ask).toMatch(/\(4X-CDE\)\./);
});

test.describe('touch screen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });
  test('the empty-route hint says Tap on a coarse pointer', async ({ page }) => {
    // The new-user intro is off by default (featureRouteIntro); this is about it.
    await page.addInitScript(() => { window.__navaidTune = Object.assign(window.__navaidTune || {}, { featureRouteIntro: true }); });
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => window.NavAid && typeof refreshEmptyRouteHint === 'function');
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    test.skip(!coarse, 'this browser profile has no coarse pointer');
    const text = await page.evaluate(() => {
      localStorage.removeItem('navaid.hintEmptyRoute'); NavAid.disclaimerDone = true;
      document.getElementById('empty-route-hint')?.remove();
      refreshEmptyRouteHint();
      return (document.getElementById('empty-route-hint') || {}).textContent;
    });
    expect(text).toMatch(/^Tap /);
  });
});
