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

test('an untouched chart inherits the last choice instead of hiding NOTAMs', async ({ page }) => {
  // Defaulting an untouched chart to OFF made NOTAMs vanish on the first switch —
  // including the drawable ULTRALIGHT BUBBLE ones, which matter most on the LSA
  // chart they disappeared from.
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
  expect(lsa.showNotam).toBe(true);        // inherited, not silently dropped
  expect(lsa.checked).toBe(true);

  const heli = await setLayer(page, 'Helicopters');
  expect(heli.showNotam).toBe(true);
});

test('charts diverge once one is actually toggled', async ({ page }) => {
  await boot(page);
  await setLayer(page, 'CVFR');
  await page.evaluate(async () => {
    const cb = document.getElementById('notam-cb');
    cb.checked = true; await cb.onchange({ target: cb });
  });
  await setLayer(page, 'Low Alt');
  await page.evaluate(async () => {
    const cb = document.getElementById('notam-cb');
    cb.checked = false; await cb.onchange({ target: cb });   // explicit: off on LSA
  });
  expect(await page.evaluate(() => localStorage.getItem('navaid.showNotam.lsa'))).toBe('0');

  const back = await setLayer(page, 'CVFR');
  expect(back.showNotam).toBe(true);       // CVFR keeps its own on
  expect(back.checked).toBe(true);

  const lsaAgain = await setLayer(page, 'Low Alt');
  expect(lsaAgain.showNotam).toBe(false);  // and LSA keeps its own off
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
  expect(lsa.showNotam).toBe(false);       // explicitly stored '0'
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

// Ultralight NOTAMs belong to the LSA chart: the feed says so in their text, and a
// CVFR plan does not want the bubble closures.
const UL_FEED = { fir: 'LLLL', notams: [
  { id: 'C0006/26', icao: 'LLLL', type: 'AECH', text: 'ULTRALIGHT BUBBLE ZVULUN NORTH (BZVUE) AVBL FOR ULTRALIGHT ACFT.',
    start: '2020-01-01T00:00:00Z', end: '2035-01-01T00:00:00Z',
    geom: { type: 'circle', lat: 32.8, lng: 35.1, radiusNm: 4 } },
  { id: 'C1639/26', icao: 'LLBG', type: 'FALC', text: 'AD CLSD TO ALL FLT INCLUDING HEL, DUE WIP.',
    start: '2020-01-01T00:00:00Z', end: '2035-01-01T00:00:00Z',
    geom: { type: 'circle', lat: 32.0, lng: 34.88, radiusNm: 3 } },
] };

async function bootUl(page) {
  await page.route(NOTAM_RE, r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(UL_FEED) }));
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof activeNotams === 'function' && Array.isArray(window.notams) && window.notams.length === 2);
}

const idsOn = (page, layer) => page.evaluate(async (n) => {
  const sel = document.getElementById('layer-select');
  sel.value = n; sel.onchange();
  await new Promise(r => setTimeout(r, 250));
  return { prefix: layerDataPrefix(), ids: activeNotams().map(x => x.id).sort() };
}, layer);

test('the LSA chart shows ultralight NOTAMs; CVFR and heli do not', async ({ page }) => {
  await bootUl(page);
  const cvfr = await idsOn(page, 'CVFR');
  expect(cvfr.ids).toEqual(['C1639/26']);              // general only

  const lsa = await idsOn(page, 'Low Alt');
  expect(lsa.ids).toEqual(['C0006/26', 'C1639/26']);   // general + ultralight

  const heli = await idsOn(page, 'Helicopters');
  expect(heli.ids).toEqual(['C1639/26']);
});

test('a general closure that merely mentions HEL stays on every chart', async ({ page }) => {
  await bootUl(page);
  for (const layer of ['CVFR', 'Low Alt', 'Helicopters']) {
    const out = await idsOn(page, layer);
    expect(out.ids).toContain('C1639/26');
  }
});

test('the whole feed is still reachable with allCharts', async ({ page }) => {
  await bootUl(page);
  await idsOn(page, 'CVFR');
  const all = await page.evaluate(() => activeNotams({ allCharts: true }).map(n => n.id).sort());
  expect(all).toEqual(['C0006/26', 'C1639/26']);
});

test('turning the overlay on from the NOTAM list writes the per-chart key', async ({ page }) => {
  // The list's "show on map" click had its own persist call, which the per-chart
  // split left pointing at the legacy shared key: the choice reverted on reload
  // and planted a legacy value every other chart then inherited.
  await bootUl(page);
  const out = await page.evaluate(async () => {
    const sel = document.getElementById('layer-select');
    sel.value = 'Low Alt'; sel.onchange();
    await new Promise(r => setTimeout(r, 250));
    localStorage.removeItem('navaid.showNotam');
    localStorage.removeItem('navaid.showNotam.lsa');
    localStorage.removeItem('navaid.showNotam.last');
    window.showNotam = false;
    await showNotamModal();
    const item = document.querySelector('.notam-item-clickable');
    if (item) item.onclick();
    return {
      showNotam: !!window.showNotam,
      scoped: localStorage.getItem('navaid.showNotam.lsa'),
      legacy: localStorage.getItem('navaid.showNotam'),
      last: localStorage.getItem('navaid.showNotam.last'),
      clickable: !!item,
    };
  });
  expect(out.clickable).toBe(true);
  expect(out.showNotam).toBe(true);
  expect(out.scoped).toBe('1');      // this chart's own key
  expect(out.last).toBe('1');        // and what an untouched chart inherits
  expect(out.legacy).toBeNull();     // never the legacy shared key
});
