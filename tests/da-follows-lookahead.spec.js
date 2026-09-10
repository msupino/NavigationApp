// @ts-check
// Density altitude is the number a pilot scrubs forward FOR: the panel's own text says
// "move the slider to find an hour that is flyable". It had its own slider, wired to
// nothing -- so the map clock at +6h, the NOTAMs at +6h and the airfield wind at +6h sat
// beside a density altitude for right now, and neither control admitted the other existed.
//
// It is one clock with several faces. This one is built fresh inside each airfield
// inspector and destroyed with it, which is why it cannot be looked up once at boot like
// the other mirrors.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof showInspector === 'function'
    && document.getElementById('lookahead-time') && window.NavAid && NavAid.da
    && Array.isArray(window.airfields) && window.airfields.length);
}

// Open the inspector on a field with a published elevation, so the density-altitude group
// is built rather than skipped.
async function openAirfield(page) {
  await page.evaluate(() => {
    const af = window.airfields.find(a => Number.isFinite(Number(a.elev_ft))) || window.airfields[0];
    state.selected = { type: 'airfield', af: af, index: 0 };
    showInspector();
  });
  await page.waitForSelector('input.da-time');
}

const daSlider = page => page.evaluate(() => document.querySelector('input.da-time').value);
const daWhen = page => page.evaluate(() => document.querySelector('.da-when').textContent);
const masterVal = page => page.evaluate(() => document.getElementById('lookahead-time').value);
const setMaster = (page, h) => page.evaluate((hh) => {
  const m = document.getElementById('lookahead-time');
  m.value = String(hh);
  m.dispatchEvent(new Event('input'));
}, h);

test('scrubbing the shared clock moves the density-altitude slider with it', async ({ page }) => {
  await boot(page);
  await openAirfield(page);
  expect(await daSlider(page)).toBe('0');

  await setMaster(page, 6);
  expect(await daSlider(page)).toBe('6');
  // And it re-read: the readout names the hour, not just the offset.
  expect(await daWhen(page)).toContain('+6');
});

test('moving the density-altitude slider moves every other timed layer', async ({ page }) => {
  await boot(page);
  await openAirfield(page);
  await page.evaluate(() => {
    const s = document.querySelector('input.da-time');
    s.value = '4';
    s.dispatchEvent(new Event('input'));
  });
  expect(await masterVal(page)).toBe('4');
  expect(await page.evaluate(() => document.getElementById('notam-time').value)).toBe('4');
  expect(await page.evaluate(() => document.getElementById('airfield-wind-time').value)).toBe('4');
  // It is one clock, so the instant is anchored the same way a scrub anchors it.
  expect(await page.evaluate(() =>
    Math.round((window.lookaheadTarget - Date.now()) / 3600e3))).toBeGreaterThanOrEqual(3);
});

test('a panel opened while the chart is scrubbed forward opens on that hour', async ({ page }) => {
  await boot(page);
  await setMaster(page, 5);
  await openAirfield(page);
  // Opening at "now" beside layers all showing +5h would answer a question nobody asked.
  expect(await daSlider(page)).toBe('5');
  expect(await daWhen(page)).toContain('+5');
});

test('the map clock reaches it too, through the same master', async ({ page }) => {
  await boot(page);
  await openAirfield(page);
  await page.evaluate(() => {
    const s = document.getElementById('map-time-slider');
    s.value = '3';
    s.dispatchEvent(new Event('input'));
  });
  expect(await daSlider(page)).toBe('3');
});

test('a closed inspector is not a mirror the cascade trips over', async ({ page }) => {
  await boot(page);
  await openAirfield(page);
  await page.evaluate(() => { state.selected = null; showInspector(); });
  await page.waitForFunction(() => !document.querySelector('#inspector:not(.hidden) input.da-time'));
  // The list of mirrors is read at each sync, so one that has gone is simply absent.
  await setMaster(page, 2);
  expect(await masterVal(page)).toBe('2');
  expect(await page.evaluate(() => document.getElementById('notam-time').value)).toBe('2');
});

test('the walk-back toward live carries it along', async ({ page }) => {
  await page.addInitScript(() => {
    window.__now = Date.UTC(2026, 5, 21, 12, 0);
    const RealDate = Date;
    Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [window.__now])); }
      static now() { return window.__now; }
    };
  });
  await boot(page);
  await openAirfield(page);
  await setMaster(page, 3);
  expect(await daSlider(page)).toBe('3');
  // "+3h" is 15:00Z, not "always three hours out". An hour later it is +2h -- on every face.
  await page.evaluate(() => { window.__now += 3600e3; });
  await page.evaluate(() => window.lookaheadTick());
  expect(await masterVal(page)).toBe('2');
  expect(await daSlider(page)).toBe('2');
});

test('the clock stops being dim while a panel that answers to it is open', async ({ page }) => {
  // Reported: with no extra layer selected the slider on the map is barely visible -- and
  // that is exactly the moment someone reading a field's density altitude wants to find it.
  // The panel is a timed layer, so the clock is live while it is open.
  await boot(page);
  const dim = () => page.evaluate(() => document.getElementById('map-time').classList.contains('idle'));
  expect(await dim(), 'nothing timed on screen yet').toBe(true);

  await openAirfield(page);
  expect(await dim(), 'a density altitude on screen answers to this clock').toBe(false);
  // Dim, never hide: the house rule holds in both states.
  expect(await page.evaluate(() => document.getElementById('map-time').hidden)).toBe(false);

  await page.evaluate(() => { state.selected = null; showInspector(); });
  await page.waitForFunction(() => !document.querySelector('#inspector:not(.hidden) input.da-time'));
  expect(await dim(), 'and goes quiet again when the panel closes').toBe(true);
});
