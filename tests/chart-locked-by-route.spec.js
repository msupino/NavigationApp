// @ts-check
// CVFR, ATS and Low Alt each carry their own route graph: their own waypoints, their own
// reporting points, their own names. A route drawn on one is a list of names the other two
// do not have -- so switching charts under a drawn route left the pilot reading a plan
// against a chart it was never built for, with the leg names silently belonging to
// somewhere else.
//
// The rest of the picker is scenery over the same ground. Navigation, Satellite,
// OpenStreetMap and the helicopter chart change what is underneath, not what the route
// means, so they stay free with a route on screen.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof draw === 'function'
    && document.getElementById('layer-select') && window.NavAid && NavAid.layerSwitchAllowed);
  await page.evaluate(() => { window.__toasts = []; window.showToast = (m) => window.__toasts.push(String(m)); });
}

const drawRoute = (page) => page.evaluate(() => {
  state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'A' }, { lat: 32.3, lng: 35.1, name: 'B' }];
  syncLegs();
  draw();
});

// Through the picker's own handler, which is what a pilot's choice runs.
const pick = (page, name) => page.evaluate((n) => {
  const sel = document.getElementById('layer-select');
  sel.value = n;
  sel.onchange();
  return sel.value;
}, name);

const active = (page) => page.evaluate(() => currentLayerName());

test('with no route, every chart is still one click away', async ({ page }) => {
  await boot(page);
  for (const name of ['ATS', 'Low Alt', 'CVFR']) {
    expect(await pick(page, name)).toBe(name);
    expect(await active(page)).toBe(name);
  }
});

test('a drawn route pins the chart it was planned on', async ({ page }) => {
  await boot(page);
  await drawRoute(page);
  expect(await active(page)).toBe('CVFR');
  expect(await pick(page, 'ATS')).toBe('CVFR');       // the picker goes back where the map is
  expect(await active(page)).toBe('CVFR');
  expect(await pick(page, 'Low Alt')).toBe('CVFR');
  // Refused out loud: a control that quietly snaps back reads as a broken control.
  const said = await page.evaluate(() => window.__toasts);
  expect(said.length).toBe(2);
  expect(said[0]).toMatch(/CVFR/);
});

test('scenery is never locked: satellite, street map, navigation, helicopters', async ({ page }) => {
  await boot(page);
  await drawRoute(page);
  for (const name of ['Satellite', 'OpenStreetMap', 'Navigation']) {
    expect(await pick(page, name), name + ' should be free').toBe(name);
    expect(await active(page)).toBe(name);
  }
  expect(await page.evaluate(() => window.__toasts.length)).toBe(0);
  // The helicopter chart is gist-gated and not offered in this build, so the picker cannot
  // be driven to it -- but it is scenery by the same rule, and the rule can be asked.
  expect(await page.evaluate(() => NavAid.layerSwitchAllowed('CVFR', 'Helicopters'))).toBe(true);
});

test('a detour through the satellite does not launder the switch', async ({ page }) => {
  await boot(page);
  await drawRoute(page);
  expect(await pick(page, 'Satellite')).toBe('Satellite');
  // The route still belongs to CVFR. Reading the active layer alone would have called this
  // Satellite -> ATS, which no rule forbids, and the guard would have waved it through.
  expect(await pick(page, 'ATS')).toBe('Satellite');
  expect(await active(page)).toBe('Satellite');
  // ...and its own chart is always reachable again.
  expect(await pick(page, 'CVFR')).toBe('CVFR');
});

test('clearing the route unpins the chart', async ({ page }) => {
  await boot(page);
  await drawRoute(page);
  expect(await pick(page, 'ATS')).toBe('CVFR');
  await page.evaluate(() => { state.waypoints = []; syncLegs(); draw(); });
  expect(await pick(page, 'ATS')).toBe('ATS');
  await drawRoute(page);
  // And the new route belongs to ATS now, not to the chart the last one was drawn on.
  expect(await pick(page, 'CVFR')).toBe('ATS');
  expect(await pick(page, 'ATS')).toBe('ATS');
});

test('a chart withdrawn by the gist can still fall back', async ({ page }) => {
  await boot(page);
  await drawRoute(page);
  // rebuildLayerPicker lands on CVFR when the active chart is pulled from service. A route
  // may not outrank that: the chart it was planned on is no longer being served.
  const allowed = await page.evaluate(() => {
    NavAid.tuningDefaults.layerEnabledATS = { value: false, type: 'bool', label: 'test' };
    const sel = document.getElementById('layer-select');
    sel.value = 'ATS';
    sel.onchange();                                  // now sitting on ATS with a route
    NavAid.tuningDefaults.layerEnabledATS.value = false;
    return NavAid.layerSwitchAllowed('ATS', 'CVFR');
  });
  expect(allowed).toBe(true);
});
