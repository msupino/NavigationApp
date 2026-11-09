// @ts-check
// Asked: "why is there a difference in waypoint inspector when on route and map point? See DEROR",
// then "also check for line wrap in freq and listen buttons". The same point reads the same way
// from the map and from the route: the frequency change comes after Reporting in both, and a
// route waypoint with its callout keeps the chart's call signs and their play buttons above the
// editor. Frequencies never wrap away from their play buttons, at any text size.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    HTMLMediaElement.prototype.pause = () => {};
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' && !!window.atcRadio
    && Array.isArray(window.airfields) && typeof addRoutePoint === 'function');
  await page.evaluate(async () => {
    NavAid.tuning.featureAtcRadio = true; refreshAtcRadioFeature();   // ships on; set explicitly
    await loadNavWaypoints(); await loadCommChange();
    window.showCommChange = true;
    window.appConfirm = async () => true; window.askYesNo = async () => true;
  });
  await page.waitForFunction(() => window.commChangeMap && Object.keys(window.commChangeMap).length > 0);
}

// The inspector's sections in order, by what each one is.
const sections = (page) => page.evaluate(() => [...document.querySelectorAll('#insp-body > *')].map(el => {
  if (el.matches('.coord-row')) return 'position';
  if (el.matches('.reporting-badge-row')) return 'reporting';
  if (el.matches('.commchange-row')) return 'freq';
  if (el.matches('.vor-radial-row')) return 'vor';
  if (el.querySelector('.satellite-expand-hint') || el.matches('.satellite-expand-hint')) return 'satellite';
  return null;
}).filter((v, i, a) => v && a.indexOf(v) === i));

const callSigns = (page) => page.evaluate(() => [...document.querySelectorAll('#inspector .commchange-option')].map(el => {
  const b = el.querySelector('[data-atc]');
  return [el.dataset.callSign, b ? b.dataset.atc : null];
}));

test('DEROR from the map and from the route: same order, same call signs and play buttons', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { state.selected = { type: 'navwp', index: navWP.findIndex(w => w.name === 'DEROR') }; showInspector(); });
  const mapOrder = await sections(page);
  const mapCalls = await callSigns(page);
  expect(mapOrder.indexOf('freq')).toBeGreaterThan(mapOrder.indexOf('reporting'));
  expect(mapCalls).toEqual([['HERZLIYA', 'herzliya-twr'], ['PLUTO_WEST', 'pluto-west']]);

  // On a route built through the change point, DEROR carries its callout (the editor).
  await page.evaluate(async () => {
    for (const n of ['LLHZ', 'BAZRA', 'DEROR', 'SHARO']) await addRoutePoint(findNavWpToken(n) || airfields.find(a => a.name === n));
    state.selected = { type: 'wp', index: state.waypoints.findIndex(w => w.name === 'DEROR') };
    showInspector();
  });
  await expect(page.locator('#inspector .commchange-freq-edit')).toBeVisible();
  const routeOrder = await sections(page);
  expect(routeOrder).toEqual(mapOrder);
  expect(await callSigns(page)).toEqual(mapCalls);
  // The list comes first, the editor under it.
  const [list, editor] = await page.evaluate(() => ['.commchange-map-row', '.commchange-freq-edit']
    .map(s => document.querySelector('#inspector ' + s).getBoundingClientRect().top));
  expect(editor).toBeGreaterThan(list);
});

test('the freq change point label carries a drawn icon, not an emoji', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { state.selected = { type: 'navwp', index: navWP.findIndex(w => w.name === 'DEROR') }; showInspector(); });
  const lbl = page.locator('#inspector .commchange-label');
  await expect(lbl.locator('svg.nav-icon')).toHaveCount(1);
  expect(await lbl.textContent()).toBe('Freq change point');
});

// Each row's play button, frequency and reset sit on one line, inside the panel.
const freqRowsHold = (page) => page.evaluate(() => {
  const panel = document.getElementById('inspector').getBoundingClientRect();
  const bad = [];
  const sameLine = (els, tag) => {
    const r = els.filter(Boolean).map(e => e.getBoundingClientRect());
    const mids = r.map(b => b.top + b.height / 2);
    if (Math.max(...mids) - Math.min(...mids) > 6) bad.push(tag + ': split across lines');
    for (const b of r) if (b.left < panel.left - 1 || b.right > panel.right + 1) bad.push(tag + ': past the panel edge');
  };
  for (const row of document.querySelectorAll('#inspector .comm-section .row')) {
    const v = row.querySelector('.val');
    if (v && v.querySelector('.charts-freq-input')) {
      sameLine([v.querySelector('.atc-play'), v.querySelector('.charts-freq-input'), v.querySelector('.commchange-freq-reset')],
        row.querySelector('label').textContent);
      const inp = v.querySelector('.charts-freq-input');
      if (inp.scrollWidth > inp.clientWidth + 1) bad.push(row.querySelector('label').textContent + ': frequency clipped');
    }
  }
  for (const item of document.querySelectorAll('#inspector .commchange-option')) {
    sameLine([item.querySelector('.atc-play'), item.querySelector('.commchange-option-freq')], item.dataset.callSign);
    const name = item.querySelector('.commchange-option-name');
    // Broken between words only: no line holds part of a word.
    const words = name.textContent.trim().split(/\s+/);
    const range = document.createRange(); range.selectNodeContents(name);
    const lines = new Set([...range.getClientRects()].map(b => Math.round(b.top))).size;
    if (lines > words.length) bad.push(item.dataset.callSign + ': name broken inside a word');
  }
  return bad;
});

for (const lang of ['en', 'he']) {
  test(`frequency rows hold together at every text size (${lang})`, async ({ page }) => {
    await page.setViewportSize({ width: 1300, height: 900 });
    await boot(page);
    if (lang === 'he') {
      await page.goto('?lang=he&nogist');
      await boot(page);
    }
    const open = (sel) => page.evaluate((sel) => { state.selected = sel; showInspector(); }, sel);
    const targets = await page.evaluate(() => [
      { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLHA') },
      { type: 'airfield', index: airfields.findIndex(a => a.name === 'LLBG') },
      { type: 'navwp', index: navWP.findIndex(w => w.name === 'DEROR') },
      { type: 'navwp', index: navWP.findIndex(w => w.name === 'DALIA') },
      { type: 'navwp', index: navWP.findIndex(w => w.name === 'ZMGID') },
    ]);
    for (const z of ['smallest', 'largest']) {
      await page.evaluate((z) => applyInspZoom(z === 'smallest' ? tune('inspZoomSmallest') : tune('inspZoomLargest')), z);
      for (const t of targets) {
        await open(t);
        expect(await freqRowsHold(page), `${lang} ${z} ${JSON.stringify(t)}`).toEqual([]);
      }
    }
    await page.evaluate(() => applyInspZoom(tune('inspZoomSmallest')));
  });
}
