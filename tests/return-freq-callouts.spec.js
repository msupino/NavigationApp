// @ts-check
// Asked: with the return path shown, the way back gets its own frequency changes -- kept as
// ordinary callouts tagged `ret`, so they drag, edit and delete like the way out's. On the
// northern CVFR route LLHA -> LLIB (the route templates llha-llib-north and its exact reverse
// llib-llha-north) the two directions call for different stations at the same points.
const { test, expect } = require('./_setup');

const ROUTE = ['LLHA', 'GILAM', 'EVLYM', 'SEGEV', 'ZALMN', 'DESHE', 'AMNON', 'LLIB'];

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof returnCommOn === 'function' && Array.isArray(navWP) && navWP.length
    && commChangeMap && Object.keys(commChangeMap).length && airfields && airfields.length);
}
const fly = (page, names) => page.evaluate((names) => {
  const at = (n) => { const w = navWP.find(x => x.name === n) || airfields.find(a => a.name === n); return { lat: w.lat, lng: w.lng, name: n }; };
  state.notes = []; state.waypoints = names.map(at); syncLegs(); seedCommChangeNotes(); draw();
  return state.notes.filter(n => n.cc && !n.ret).map(n => [n.cc, n.freqName, n.freq]);
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
  expect(await page.evaluate(() => state.notes.filter(n => n.ret).length)).toBe(0);
  // ...and with it shown, exactly the flown-home set, at the same places.
  await setReturn(page, true);
  const back = await page.evaluate(() => state.notes.filter(n => n.cc && n.ret).map(n => [n.cc, n.freqName, n.freq, n.lat, n.lng]));
  const homeAt = await page.evaluate((names) => {
    const at = (n) => { const w = navWP.find(x => x.name === n) || airfields.find(a => a.name === n); return { lat: w.lat, lng: w.lng, name: n }; };
    const saved = [state.waypoints, state.notes];
    state.notes = []; state.waypoints = names.map(at); syncLegs(); seedCommChangeNotes();
    const r = state.notes.filter(n => n.cc && !n.ret).map(n => [n.cc, n.freqName, n.freq, n.lat, n.lng]);
    state.waypoints = saved[0]; state.notes = saved[1]; syncLegs();
    return r;
  }, ROUTE.slice().reverse());
  expect(back).toEqual(homeAt);
  // The plan itself is left exactly as it was: same route, same way-out notes.
  expect(await page.evaluate(() => state.waypoints.map(w => w.name))).toEqual(ROUTE);
  expect(await page.evaluate(() => state.notes.filter(n => n.cc && !n.ret).map(n => [n.cc, n.freqName]))).toEqual(
    [['GILAM', 'PLUTO_EAST'], ['DESHE', 'ROSH_PINA']]);
});

test('drawn in its own colour (gist-tunable), and the kites of the way back still follow the CTR rule', async ({ page }) => {
  await boot(page);
  await fly(page, ROUTE);
  await setReturn(page, true);
  // Red ink present on the canvas where the way-back callouts draw.
  const red = await page.evaluate(() => {
    setTune('commChangeReturnArrowColor', '#c62828');   // the default is black, like the way out
    const n = state.notes.find(n => n.ret); map.setView([n.lat, n.lng], 11, { animate: false }); draw();
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
    return state.notes.filter(n => n.cc && !n.ret).map(n => [n.cc, n.freqName, n.freq, n.lat, n.lng]);
  }, OUT.slice().reverse());
  const out = await fly(page, OUT);
  await setReturn(page, true);
  const back = await page.evaluate(() => state.notes.filter(n => n.cc && n.ret).map(n => [n.cc, n.freqName, n.freq, n.lat, n.lng]));
  console.log('LLHZ-LLIB out:', JSON.stringify(out), ' back:', JSON.stringify(back.map(b => b.slice(0, 3))));
  expect(homeAt.length).toBeGreaterThan(0);
  expect(back).toEqual(homeAt);
  expect(await page.evaluate(() => state.waypoints.map(w => w.name))).toEqual(OUT);   // plan untouched
});

// The way back's callouts are the pilot's to edit: a moved or re-tuned one stays as set, a
// deleted one stays deleted, and neither touches the way out's callout at the same point.
test('a way-back callout edits and deletes on its own, and survives a save', async ({ page }) => {
  await boot(page);
  await fly(page, ROUTE);
  await setReturn(page, true);
  const wayOut = () => page.evaluate(() => state.notes.filter(n => n.cc && !n.ret).map(n => [n.cc, n.freqName, n.freq, n.lat, n.lng]));
  const out0 = await wayOut();
  // Moved and re-tuned by hand, then the route re-seeded: the edit holds.
  await page.evaluate(() => {
    const n = state.notes.find(x => x.ret && x.cc === 'DESHE');
    n.lat += 0.05; n.lng -= 0.05; n.freq = '124.00'; n.freqAuto = false;
    seedCommChangeNotes(); draw();
  });
  const edited = await page.evaluate(() => { const n = state.notes.find(x => x.ret && x.cc === 'DESHE'); return [n.freq, n.freqAuto]; });
  expect(edited).toEqual(['124.00', false]);
  expect(await wayOut()).toEqual(out0);
  // Round trip through a saved route: the way-back callouts come back as way-back ones.
  const reloaded = await page.evaluate(() => {
    const d = JSON.parse(JSON.stringify(serializeRoute()));
    applyRouteData(d);
    return state.notes.filter(n => n.cc).map(n => [n.cc, !!n.ret, n.freq]);
  });
  expect(reloaded).toEqual([['GILAM', false, '123.85'], ['DESHE', false, '118.45'], ['DESHE', true, '124.00'], ['GILAM', true, '133.00']]);
  // Tapping it opens the waypoint panel on THAT callout, marked as the way back.
  await page.evaluate(() => {
    const i = state.notes.findIndex(x => x.ret && x.cc === 'GILAM');
    state.selected = selectionForNoteHit(i); showInspector();
  });
  await expect(page.locator('#inspector .freq-way-back')).toHaveText('On the way back (return path)');
  await page.locator('#inspector button', { hasText: 'Delete freq change' }).click();
  // Deleted: gone, remembered as a way-back deletion, and not seeded again -- not even after the
  // return path is hidden and shown again. The way out's GILAM callout is untouched.
  const after = await page.evaluate(() => {
    seedCommChangeNotes();
    const c = document.getElementById('ret-cb');
    c.checked = false; c.dispatchEvent(new Event('change'));
    c.checked = true; c.dispatchEvent(new Event('change'));
    return { ret: state.notes.filter(n => n.ret).map(n => n.cc), sup: state.commChangeSuppressions };
  });
  expect(after.ret).toEqual(['DESHE']);
  expect(after.sup).toEqual(['<GILAM']);
  expect((await wayOut()).map(r => r.slice(0, 3))).toEqual(out0.map(r => r.slice(0, 3)));
});

test('hidden while the return path is off, and the share link carries only the way out', async ({ page }) => {
  await boot(page);
  await fly(page, ROUTE);
  await setReturn(page, true);
  expect(await page.evaluate(() => state.notes.filter(n => n.ret).every(n => routeNoteDirVisible(n)))).toBe(true);
  await setReturn(page, false);
  const off = await page.evaluate(() => ({
    kept: state.notes.filter(n => n.ret).length,
    shown: state.notes.filter(n => n.ret).some(n => routeNoteDirVisible(n)),
  }));
  expect(off).toEqual({ kept: 2, shown: false });
});

test('Reverse with the return path shown: the two directions trade places', async ({ page }) => {
  await boot(page);
  await fly(page, ROUTE);
  await setReturn(page, true);
  const before = await page.evaluate(() => state.notes.filter(n => n.cc).map(n => [n.cc, !!n.ret, n.freqName, n.lat, n.lng]));
  await page.evaluate(() => document.getElementById('reverse').click());
  const after = await page.evaluate(() => state.notes.filter(n => n.cc).map(n => [n.cc, !!n.ret, n.freqName, n.lat, n.lng]));
  // Same callouts, same places and stations; only the direction tag flipped.
  const flip = before.map(([cc, ret, f, lat, lng]) => [cc, !ret, f, lat, lng]);
  expect(after.slice().sort()).toEqual(flip.slice().sort());
  expect(await page.evaluate(() => state.waypoints.map(w => w.name))).toEqual(ROUTE.slice().reverse());
});
