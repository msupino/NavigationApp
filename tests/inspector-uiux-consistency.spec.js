// @ts-check
// A UI/UX pass over every kind of inspector (route waypoint, leg, airfield, reporting point,
// VOR, note, map point). What it found, pinned:
//  - every point you can fly to carries the same pair of actions, Direct to and Add to route --
//    the airfield had only the second, the VOR neither;
//  - a note's header named nothing, where every other kind names itself;
//  - the inline icon controls and sliders were under the web's 24px target (20x18, 20x23, 16px).
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showInspector === 'function' && Array.isArray(window.airfields)
    && airfields.length && window.vors && vors.length);
  await page.evaluate(() => {
    const hz = airfields.find(a => a.name === 'LLHZ');
    state.waypoints = [{ lat: hz.lat, lng: hz.lng, name: 'LLHZ' }, { lat: 32.4, lng: 34.95, name: '' }];
    state.notes = [{ lat: 32.3, lng: 34.9, text: 'Check gate', shape: 'rect', color: '#ffd84a' }];
    state.legs = []; syncLegs(); draw();
  });
}
const open = (page, sel) => page.evaluate(s => { state.selected = eval('(' + s + ')'); showInspector(); }, sel);

for (const [name, sel] of [
  ['VOR', "{type:'vor',index:vors.findIndex(v=>v.ident==='NAT')}"],
  ['airfield', "{type:'airfield',index:airfields.findIndex(a=>a.name==='LLHA')}"],
]) {
  test(name + ': Direct to and Add to route, like every point to fly to', async ({ page }) => {
    await boot(page);
    await open(page, sel);
    await expect(page.locator('#insp-direct-to')).toBeVisible();
    await expect(page.locator('#insp-add-to-route')).toBeVisible();
    await expect(page.locator('#insp-add-to-route')).toBeEnabled();
  });
}

test('a VOR added to the route lands on the station', async ({ page }) => {
  await boot(page);
  await open(page, "{type:'vor',index:vors.findIndex(v=>v.ident==='NAT')}");
  await page.locator('#insp-add-to-route').click();
  const last = await page.evaluate(() => {
    const v = vors.find(x => x.ident === 'NAT'); const w = state.waypoints[state.waypoints.length - 1];
    return { n: state.waypoints.length, d: Math.hypot(w.lat - v.lat, w.lng - v.lng) };
  });
  expect(last.n).toBe(3);
  expect(last.d).toBeLessThan(0.01);
});

test('a note names itself in the header', async ({ page }) => {
  await boot(page);
  await open(page, "{type:'note',index:0}");
  await expect(page.locator('#insp-title')).toHaveValue('Note');
});

test('inline icon controls and sliders are at least 24px', async ({ page }) => {
  await boot(page);
  await open(page, "{type:'note',index:0}");
  const sizes = await page.evaluate(() => [...document.querySelectorAll('#inspector .slider-reset, #inspector input[type=range]')]
    .filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  expect(sizes.length).toBeGreaterThan(0);
  for (const [w, h] of sizes) { expect(w).toBeGreaterThanOrEqual(24); expect(h).toBeGreaterThanOrEqual(24); }
});

test('a default value still reads at 4.5:1 in the dark theme', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('navaid.theme', 'dark'));
  await boot(page);
  await open(page, "{type:'vor',index:vors.findIndex(v=>v.ident==='NAT')}");
  const ratio = await page.locator('#inspector .charts-freq-input.is-default').evaluate(e => {
    const lum = c => c.match(/[\d.]+/g).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
      .reduce((a, v, i) => a + [0.2126, 0.7152, 0.0722][i] * v, 0);
    const s = getComputedStyle(e);
    const a = lum(s.color), b = lum(s.backgroundColor);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});
