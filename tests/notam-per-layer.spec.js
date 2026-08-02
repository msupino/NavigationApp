// The NOTAM overlay's on/off state is remembered per chart (cvfr / lsa / heli).
// The feed itself is FIR-wide with no per-chart split, but what you want drawn is
// not: CVFR cross-country wants the airspace NOTAMs up, an LSA or heli chart is
// usually flown without them, and one shared flag carried the other chart's choice.
const { test, expect } = require('./_setup');

const NOTAMS = { generatedAt: new Date().toISOString(), source: 'test', fir: 'LLLL', notams: [
  { id: 'A0001/26', icao: 'LLBG', type: 'airspace', text: 'TEST NOTAM ONE',
    start: '2020-01-01T00:00:00Z', end: '2030-01-01T00:00:00Z',
    geom: { type: 'circle', lat: 32.0, lng: 34.9, radiusNm: 5 } },
] };

// Same pattern notam-layer.spec.js uses: _setup blocks the live feed, and a route
// registered later wins — an empty feed disables the toggle by design.
const NOTAM_RE = /notam-data\/notam\.json/;

async function boot(page) {
  await page.route(NOTAM_RE, r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(NOTAMS) }));
  await page.addInitScript(() => {
    try {
      for (const sec of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + sec, '1');
    } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof notamPrefKey === 'function' && window.notams !== null);
}

const setLayer = (page, name) => page.evaluate(async (n) => {
  const sel = document.getElementById('layer-select');
  sel.value = n;
  sel.onchange();
  await new Promise(r => setTimeout(r, 250));
  return { prefix: layerDataPrefix(), showNotam: !!window.showNotam,
           checked: document.getElementById('notam-cb').checked };
}, name);

test('the preference key follows the chart, not the session', async ({ page }) => {
  await boot(page);
  const keys = await page.evaluate(async () => {
    const out = {};
    for (const [layer, pfx] of [['CVFR', 'cvfr'], ['Low Alt', 'lsa'], ['Helicopters', 'heli']]) {
      const sel = document.getElementById('layer-select');
      sel.value = layer; sel.onchange();
      await new Promise(r => setTimeout(r, 200));
      out[pfx] = notamPrefKey();
    }
    return out;
  });
  expect(keys).toEqual({ cvfr: 'navaid.showNotam.cvfr', lsa: 'navaid.showNotam.lsa',
                         heli: 'navaid.showNotam.heli' });
});

test('turning NOTAMs on for CVFR leaves LSA and heli off', async ({ page }) => {
  await boot(page);
  await setLayer(page, 'CVFR');
  await page.evaluate(async () => {
    const cb = document.getElementById('notam-cb');
    cb.checked = true;
    await cb.onchange({ target: cb });
  });
  expect(await page.evaluate(() => localStorage.getItem('navaid.showNotam.cvfr'))).toBe('1');

  const lsa = await setLayer(page, 'Low Alt');
  expect(lsa.prefix).toBe('lsa');
  expect(lsa.showNotam).toBe(false);       // LSA keeps its own (unset -> off)
  expect(lsa.checked).toBe(false);

  const heli = await setLayer(page, 'Helicopters');
  expect(heli.showNotam).toBe(false);

  const back = await setLayer(page, 'CVFR');
  expect(back.showNotam).toBe(true);       // and CVFR still has it on
  expect(back.checked).toBe(true);
});

test('each chart keeps its own choice across a reload', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    localStorage.setItem('navaid.showNotam.cvfr', '1');
    localStorage.setItem('navaid.showNotam.lsa', '0');
  });
  await page.reload();
  await page.waitForFunction(() => typeof notamPrefKey === 'function' && window.notams !== null);
  await page.waitForFunction(() => Array.isArray(window.notams) && window.notams.length > 0);
  expect(await page.evaluate(() => notamPrefRead())).toBe(true);      // boots on CVFR
  expect(await page.evaluate(() => !!window.showNotam)).toBe(true);
  const lsa = await setLayer(page, 'Low Alt');
  expect(lsa.showNotam).toBe(false);
});

test('a pre-split preference is adopted, not dropped', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('navaid.showNotam', '1'); } catch (e) {}
  });
  await boot(page);
  // The old single flag applies to the chart that is up when it is first read...
  expect(await page.evaluate(() => !!window.showNotam)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('navaid.showNotam.cvfr'))).toBe('1');
  // ...and stays available for the other charts to inherit once.
  expect(await page.evaluate(() => localStorage.getItem('navaid.showNotam'))).toBe('1');
  const lsa = await setLayer(page, 'Low Alt');
  expect(lsa.showNotam).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('navaid.showNotam.lsa'))).toBe('1');
});

test('the "Nav waypoints from" override decides the key on a base map', async ({ page }) => {
  await boot(page);
  const key = await page.evaluate(async () => {
    const sel = document.getElementById('layer-select');
    sel.value = 'Satellite'; sel.onchange();
    await new Promise(r => setTimeout(r, 200));
    const before = notamPrefKey();
    const src = document.getElementById('navwp-source');
    src.value = 'heli';
    src.onchange({ target: src });
    await new Promise(r => setTimeout(r, 250));
    return { before, after: notamPrefKey() };
  });
  expect(key.before).toBe('navaid.showNotam.cvfr');   // base map follows CVFR by default
  expect(key.after).toBe('navaid.showNotam.heli');    // and the override moves it
});
