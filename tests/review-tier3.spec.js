// @ts-check
// Third batch from the whole-codebase review: a weather chart labelled with the wrong day, a
// transposed coordinate accepted from the assistant, and a boot that stops halfway when the
// browser refuses storage.
const { test, expect } = require('./_setup');
const { enableAssistant } = require('./_assistant-on');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAYAAAB7P3qAAAAAAElFTkSuQmCC',
  'base64');

// The two feeds offer the SAME clock time on DIFFERENT days — the case that broke.
const PWX = {
  generatedAt: '2026-06-21T09:00:00Z', run: '202606210912',
  bounds: { s: 29.88, n: 33.82, w: 33.31, e: 36.69 },
  levels: [{ level: '90', label: 'FL030', times: [
    { valid: '18:00', day: '22/06/2026', png: 'ims/pwx/90/pwx-22-1800.png' },
  ] }],
};
const SIGWX = {
  generatedAt: '2026-06-21T09:00:00Z',
  times: [{ valid: '18:00', day: '21/06/2026', png: 'ims/sigwx/sig-21-1800.png' }],
};

async function bootWx(page) {
  await page.route(/ims-data\/ims\/.*\.png/, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(/ims-data\/ims\/pwx\.json/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PWX) }));
  await page.route(/ims-data\/ims\/sigwx\.json/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SIGWX) }));
  await page.addInitScript(() => {
    for (const s of ['build', 'view', 'display', 'charts', 'export', 'print']) {
      try { localStorage.setItem('navaid.sec.' + s, '1'); } catch (e) {}
    }
  });  await page.goto('?lang=en&nogist');
  await enableAssistant(page);
  await page.waitForFunction(() => document.querySelectorAll('#wx-time option').length > 1);
}

test('the same clock time on two days is two options, each labelled with its own day', async ({ page }) => {
  await bootWx(page);
  const opts = await page.evaluate(() => Array.from(document.querySelectorAll('#wx-time option'),
    o => ({ value: o.value, label: o.textContent })));
  // Deduping on the valid time alone let one feed's 18:00 swallow the other's, and since each
  // overlay resolved its own entry by valid alone, the loser rendered a chart 24 h from the day
  // printed on the option.
  expect(opts).toHaveLength(2);
  expect(opts.map(o => o.label).sort())
    .toEqual(['21/06/2026 18:00Z', '22/06/2026 18:00Z']);
  // ...and the value carries the day, so the two are distinguishable at all.
  for (const o of opts) expect(o.value).toMatch(/^\d{2}\/\d{2}\/\d{4}\|18:00$/);
});

test('each overlay resolves the chart for the selected DAY, not just the hour', async ({ page }) => {
  await bootWx(page);
  // PWX carries 22/06 and SIGWX 21/06, so each selection may be claimed by exactly one feed.
  const viaHelper = await page.evaluate(() => {
    const sel = document.getElementById('wx-time');
    const pick = day => {
      sel.value = Array.from(sel.options).find(o => o.textContent.startsWith(day)).value;
    };
    const out = {};
    pick('22/06/2026');
    out.pwxOn22 = NavWxTime.match({ valid: '18:00', day: '22/06/2026' });
    out.sigwxOn22 = NavWxTime.match({ valid: '18:00', day: '21/06/2026' });
    pick('21/06/2026');
    out.pwxOn21 = NavWxTime.match({ valid: '18:00', day: '22/06/2026' });
    out.sigwxOn21 = NavWxTime.match({ valid: '18:00', day: '21/06/2026' });
    // A manifest with no day at all still resolves on the hour, as older ones must.
    out.dayless = NavWxTime.match({ valid: '18:00' });
    return out;
  });
  expect(viaHelper.pwxOn22).toBe(true);
  expect(viaHelper.sigwxOn22).toBe(false);   // yesterday's chart is NOT this option
  expect(viaHelper.pwxOn21).toBe(false);
  expect(viaHelper.sigwxOn21).toBe(true);
  expect(viaHelper.dayless).toBe(true);
});

test('near midnight the dropdown seeds tomorrow, not a stale afternoon chart', async ({ page }) => {
  await page.addInitScript(() => {
    // 23:45Z. imsNearestTimeIndex was given options stripped of their day, so it assumed every
    // hour was TODAY and picked 18:00 — nearly six hours stale — over 00:00 fifteen minutes out.
    const fixed = Date.UTC(2026, 5, 21, 23, 45);
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [fixed])); }
      static now() { return fixed; }
    };
  });
  await page.route(/ims-data\/ims\/.*\.png/, r =>
    r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route(/ims-data\/ims\/pwx\.json/, r => r.fulfill({ status: 404, body: '' }));
  await page.route(/ims-data\/ims\/sigwx\.json/, r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ generatedAt: '2026-06-21T18:00:00Z', times: [
      { valid: '18:00', day: '21/06/2026', png: 'ims/sigwx/a.png' },
      { valid: '00:00', day: '22/06/2026', png: 'ims/sigwx/b.png' },
      { valid: '03:00', day: '22/06/2026', png: 'ims/sigwx/c.png' },
    ] }),
  }));  await page.goto('?lang=en&nogist');
  await enableAssistant(page);
  await page.waitForFunction(() => document.querySelectorAll('#wx-time option').length === 3);
  const seeded = await page.evaluate(() => {
    const sel = document.getElementById('wx-time');
    return sel.options[sel.selectedIndex].textContent;
  });
  expect(seeded).toBe('22/06/2026 00:00Z');
});

// --- assistant.js: a transposed coordinate is a typo, not a route ---------------------
test('the assistant refuses transposed coordinates', async ({ page }) => {  await page.goto('?lang=en&nogist');
  await enableAssistant(page);
  await page.waitForFunction(() => window.NavAid && NavAid.assistant &&
    typeof NavAid.assistant._runTool === 'function');
  const r = await page.evaluate(async () => {
    NavAid.assistant._setConfirm(() => true);
    const out = {};
    // LLKS is 32.98,35.57. Transposed it lands in the sea north of Cyprus, ~250 NM out — and
    // both halves of the old padded box accepted it, because lat 27-36 and lng 32-38 overlap.
    out.swapped = await NavAid.assistant._runTool('set_route',
      { points: ['32.98,35.57', '35.57,32.98'] });
    out.afterSwapped = state.waypoints.length;
    state.waypoints = []; syncLegs();
    // The right way round still works...
    out.ok = await NavAid.assistant._runTool('set_route',
      { points: ['32.98,35.57', '32.10,34.80'] });
    out.afterOk = state.waypoints.length;
    state.waypoints = []; syncLegs();
    // ...and a legitimate point west of the coast, outside the tight box, is still accepted:
    // narrowing the box instead of testing for a transposition would have rejected it.
    out.sea = await NavAid.assistant._runTool('set_route',
      { points: ['32.50,33.40', '32.10,34.80'] });
    out.afterSea = state.waypoints.length;
    return out;
  });
  expect(r.afterSwapped).not.toBe(2);          // the transposed pair did not become a route
  expect(r.afterOk).toBe(2);
  expect(r.afterSea).toBe(2);
});

// --- ui.js: a browser that refuses storage must not stop the boot --------------------
test('blocked site data does not abort the rest of ui.js', async ({ page }) => {
  await page.addInitScript(() => {
    // What Safari private mode and Chrome's "block site data" actually do: throw.
    const boom = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => ({ getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 }),
    });
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));  await page.goto('?lang=en&nogist');
  await enableAssistant(page);
  await page.waitForFunction(() => typeof map !== 'undefined');
  const state1 = await page.evaluate(() => ({
    // Declared AFTER the reads that used to throw, in file order — their presence is what
    // proves ui.js ran to the end rather than aborting partway.
    showCircuit: typeof window.showCircuit,
    showCommfail: typeof window.showCommfail,
    // The last things ui.js wires up: a toolbar control and the theme handling.
    themeSet: typeof window.applyTheme === 'function' || typeof window.setTheme === 'function',
    vorCb: !!document.getElementById('vor-cb'),
  }));
  expect(state1.showCircuit).toBe('boolean');
  expect(state1.showCommfail).toBe('boolean');
  expect(state1.vorCb).toBe(true);
  // Not the tuning panel: that is gated on ?tune, so its absence here is correct.
  expect(errors.filter(m => /insecure|SecurityError/i.test(m))).toEqual([]);
});
