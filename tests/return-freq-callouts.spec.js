// @ts-check
// Asked: with the return path shown, the way back gets its own frequency changes. On the
// northern CVFR route LLHA -> LLIB (the route templates llha-llib-north and its exact reverse
// llib-llha-north) the two directions call for different stations at the same points.
const { test, expect } = require('./_setup');

const ROUTE = ['LLHA', 'GILAM', 'EVLYM', 'SEGEV', 'ZALMN', 'DESHE', 'AMNON', 'LLIB'];

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof returnCommCallouts === 'function' && Array.isArray(navWP) && navWP.length
    && commChangeMap && Object.keys(commChangeMap).length && airfields && airfields.length);
}
const fly = (page, names) => page.evaluate((names) => {
  const at = (n) => { const w = navWP.find(x => x.name === n) || airfields.find(a => a.name === n); return { lat: w.lat, lng: w.lng, name: n }; };
  state.notes = []; state.waypoints = names.map(at); syncLegs(); seedCommChangeNotes(); draw();
  return state.notes.filter(n => n.cc).map(n => [n.cc, n.freqName, n.freq]);
}, names);
// The return path is a gist feature (featureShowReturn, off by default): on for these tests.
const setReturn = (page, on) => page.evaluate((on) => {
  NavAid.tuning.featureShowReturn = true;
  const c = document.getElementById('ret-cb'); c.checked = on; c.dispatchEvent(new Event('change')); draw();
}, on);

test('LLHA -> LLIB and back: the way back calls the stations flying home', async ({ page }) => {
  await boot(page);
  // The way home flown for real: what the app seeds on LLIB -> LLHA.
  const home = await fly(page, ROUTE.slice().reverse());
  expect(home).toEqual([['DESHE', 'PLUTO_EAST', '123.85'], ['GILAM', 'HAIFA', '133.00']]);
  // Out and back on one plan: the way out keeps its own callouts...
  const out = await fly(page, ROUTE);
  expect(out).toEqual([['GILAM', 'PLUTO_EAST', '123.85'], ['DESHE', 'ROSH_PINA', '118.45']]);
  // ...nothing for the way back while it is not shown...
  await setReturn(page, false);
  expect(await page.evaluate(() => returnCommCallouts().length)).toBe(0);
  // ...and with it shown, exactly the flown-home set, at the same places.
  await setReturn(page, true);
  const back = await page.evaluate(() => returnCommCallouts().map(n => [n.cc, n.freqName, n.freq, n.lat, n.lng]));
  const homeAt = await page.evaluate((names) => {
    const at = (n) => { const w = navWP.find(x => x.name === n) || airfields.find(a => a.name === n); return { lat: w.lat, lng: w.lng, name: n }; };
    const saved = [state.waypoints, state.notes];
    state.notes = []; state.waypoints = names.map(at); syncLegs(); seedCommChangeNotes();
    const r = state.notes.filter(n => n.cc).map(n => [n.cc, n.freqName, n.freq, n.lat, n.lng]);
    state.waypoints = saved[0]; state.notes = saved[1]; syncLegs();
    return r;
  }, ROUTE.slice().reverse());
  expect(back).toEqual(homeAt);
  // The plan itself is left exactly as it was: same route, same way-out notes.
  expect(await page.evaluate(() => state.waypoints.map(w => w.name))).toEqual(ROUTE);
  expect(await page.evaluate(() => state.notes.filter(n => n.cc).map(n => [n.cc, n.freqName]))).toEqual(
    [['GILAM', 'PLUTO_EAST'], ['DESHE', 'ROSH_PINA']]);
});

test('drawn in the return colour, and the kites of the way back still follow the CTR rule', async ({ page }) => {
  await boot(page);
  await fly(page, ROUTE);
  await setReturn(page, true);
  // Red ink present on the canvas where the way-back callouts draw.
  const red = await page.evaluate(() => {
    const n = returnCommCallouts()[0]; map.setView([n.lat, n.lng], 11, { animate: false }); draw();
    const p = map.latLngToContainerPoint([n.lat, n.lng]), c = octx.canvas, k = c.width / c.clientWidth;
    const d = octx.getImageData(Math.round(p.x * k) - 60, Math.round(p.y * k) - 60, 120, 120).data;
    let hits = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 170 && d[i + 1] < 80 && d[i + 2] < 80 && d[i + 3] > 200) hits++;
    return hits;
  });
  expect(red).toBeGreaterThan(20);
  // Kites: the same hide rule both ways (legInsideCtr covers the arrival field as well).
  const inside = await page.evaluate(() => state.legs.map((leg, i) => legKiteVisible(i, leg)));
  expect(inside.length).toBe(ROUTE.length - 1);
});

// Same check on the long northern route from Herzliya (llhz-llib-north / llib-llhz-north):
// whatever the way home seeds when flown, the return callouts on the out-and-back plan match it.
test('LLHZ -> LLIB and back: the way back matches the route flown home', async ({ page }) => {
  const OUT = ['LLHZ', 'BAZRA', 'DEROR', 'SHARO', 'HADRA', 'EIRON', 'ZMGID', 'AFULA', 'TAVOR', 'DESHE', 'AMNON', 'LLIB'];
  await boot(page);
  const homeAt = await page.evaluate((names) => {
    const at = (n) => { const w = navWP.find(x => x.name === n) || airfields.find(a => a.name === n); return { lat: w.lat, lng: w.lng, name: n }; };
    state.notes = []; state.waypoints = names.map(at); syncLegs(); seedCommChangeNotes();
    return state.notes.filter(n => n.cc).map(n => [n.cc, n.freqName, n.freq, n.lat, n.lng]);
  }, OUT.slice().reverse());
  const out = await fly(page, OUT);
  await setReturn(page, true);
  const back = await page.evaluate(() => returnCommCallouts().map(n => [n.cc, n.freqName, n.freq, n.lat, n.lng]));
  console.log('LLHZ-LLIB out:', JSON.stringify(out), ' back:', JSON.stringify(back.map(b => b.slice(0, 3))));
  expect(homeAt.length).toBeGreaterThan(0);
  expect(back).toEqual(homeAt);
  expect(await page.evaluate(() => state.waypoints.map(w => w.name))).toEqual(OUT);   // plan untouched
});
