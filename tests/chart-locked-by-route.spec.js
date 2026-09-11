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

// Reported: the warning about changing layers with a route loaded is too short. It was --
// every toast shared one hard-coded 2500 ms, which is fine for "Copied" and nowhere near
// enough for a sentence explaining why a control just refused. A refusal that vanishes
// before it has been read looks like a control that broke.
//
// So the duration comes from the sentence: notice + words/wpm, floored and capped.
test('a toast is timed by how long it takes to read', async ({ page }) => {
  // Not boot(): that replaces showToast with a collector, and this is about the real one.
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof toastReadMs === 'function'
    && window.NavAid && NavAid.tuningDefaults.toastReadWpm);
  const got = await page.evaluate(() => {
    const d = NavAid.tuningDefaults;
    const words = (n) => new Array(n).fill('word').join(' ');
    return {
      floorShort: toastReadMs('Copied', false),
      floorWarn: toastReadMs('Copied', true),
      min: d.toastMinMs.value, warnMin: d.toastWarnMinMs.value, cap: d.toastMaxMs.value,
      // 60 words at 180 wpm is 20 s of reading, so the cap is what answers.
      long: toastReadMs(words(600), false),
      // 30 words: 10 s of reading plus the notice beat, well clear of both floors.
      mid: toastReadMs(words(30), false),
      midWarn: toastReadMs(words(30), true),
      notice: d.toastNoticeMs.value, wpm: d.toastReadWpm.value,
    };
  });
  // A two-word acknowledgement is held by the floor, not by its own reading time.
  expect(got.floorShort).toBe(got.min);
  // `warn` raises the floor and nothing else: a short warning is still a short read.
  expect(got.floorWarn).toBe(got.warnMin);
  expect(got.warnMin).toBeGreaterThan(got.min);
  // In the middle the formula itself decides, and warn changes nothing there.
  expect(got.mid).toBe(Math.round(got.notice + (30 / got.wpm) * 60000));
  expect(got.midWarn).toBe(got.mid);
  // And nothing parks itself over the chart for ever.
  expect(got.long).toBe(got.cap);
});

test('showToast arms the timer the formula asked for', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showToast === 'function' && typeof toastReadMs === 'function');
  const got = await page.evaluate(() => {
    const seen = [];
    const real = window.setTimeout;
    window.setTimeout = function (fn, ms) { seen.push(ms); return real(fn, ms); };
    const text = 'a refusal with rather more words in it than an acknowledgement has';
    showToast(text);
    showToast(text, { warn: true });
    showToast('explicit', { ms: 1234 });     // a caller with its own reason still wins
    window.setTimeout = real;
    return { armed: seen.filter(ms => ms > 300), want: toastReadMs(text, false) };
  });
  expect(got.armed).toEqual([got.want, got.want, 1234]);
});

test('the chart refusal is a warning, not an acknowledgement', async ({ page }) => {
  await boot(page);
  await drawRoute(page);
  const asked = await page.evaluate(() => {
    let opts = null;
    const real = window.showToast;
    window.showToast = (msg, o) => { opts = o; return real(msg, o); };
    const sel = document.getElementById('layer-select');
    sel.value = 'ATS';
    sel.onchange();
    window.showToast = real;
    return opts;
  });
  expect(asked).toEqual({ warn: true });
});

// Every toast is timed by its own words. What is opt-in is the WARNING FLOOR, and the point
// of a floor is that a refusal is never as brief as an acknowledgement -- so the call sites
// that refuse, or report something that failed, have to ask for it. This is the list; if a
// new refusal is added without it, that is what this test is here to notice.
test('every refusal and outage asks for the warning floor', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showToast === 'function');
  const src = await page.evaluate(async () => {
    const files = ['app/ui.js', 'app/io.js', 'app/draw.js', 'app/traffic.js', 'app/followme.js'];
    const out = {};
    for (const f of files) out[f] = await (await fetch(f + '?v=src')).text();
    return out;
  });
  // Each entry: the string a call site shows, and the file it lives in.
  const mustWarn = [
    ['app/ui.js', 'editLockBlockedToast'],       // the route is locked: the edit refused
    ['app/ui.js', 'reverseNoRoute'],             // nothing to reverse
    ['app/ui.js', 'followMeShareFailed'],        // the link could not be shared
    ['app/ui.js', 'errRouteChartLocked'],        // the chart change refused
    ['app/io.js', 'routeLibraryGdriveAutoSyncFailed'],
    ['app/io.js', 'freqSourceNotamGone'],
    ['app/io.js', 'altPairsLocationMissing'],
    ['app/draw.js', 'airspaceUnavailable'],
    ['app/traffic.js', 'trafficUnavailable'],
  ];
  const missing = [];
  for (const [file, key] of mustWarn) {
    const text = src[file] || '';
    const at = text.indexOf(key);
    if (at < 0) { missing.push(key + ' (string gone from ' + file + ')'); continue; }
    // The options object follows the message, within the same call.
    const window300 = text.slice(at, at + 400);
    if (!/warn:\s*(true|!stopping)/.test(window300)) missing.push(key + ' in ' + file);
  }
  expect(missing).toEqual([]);
});

test('an acknowledgement does not borrow the warning floor', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof toastReadMs === 'function');
  // "Copied" is two words and should go as soon as it has registered. A floor meant for a
  // refusal would leave it sitting over the chart for twice as long as it earns.
  const got = await page.evaluate(() => ({
    ack: toastReadMs('Route link copied to clipboard', false),
    warn: toastReadMs('Route link copied to clipboard', true),
  }));
  expect(got.ack).toBeLessThan(got.warn);
});
