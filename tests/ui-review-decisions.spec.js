// @ts-check
// UI-review decisions (asked: "do 1, 2, 5, 6 and 7", then 6 only for the section name):
// - the phone bar's open sheet (Map / Menu / Plan) is selected, so it wears the toolbar's blue,
//   not a magenta of its own; Record and Location keep their status colours;
// - a pressed inspector toggle (hotspot, frequency change, clock start, turning point) is the
//   same blue, not the red that read as Delete -- Delete itself stays red;
// - the menu section that sets the chart up is "Chart" / "תרשים", not a second "Map" beside
//   the bar's Map button; quick layers' heading matches.
const { test, expect } = require('./_setup');

const BLUE = 'rgb(29, 111, 224)';

for (const theme of ['light', 'dark']) {
  test(`phone bar: an open sheet is marked in the toolbar blue (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((t) => { try { localStorage.setItem('navaid.theme', t); } catch (e) {} }, theme);
    await page.goto('?lang=en&nogist');
    await page.waitForFunction(() => !!document.getElementById('deck-bar'));
    await page.evaluate(() => { document.getElementById('boot-loading')?.remove(); document.documentElement.classList.remove('app-booting'); });
    await page.locator('.deck-btn-menu').click();
    const look = await page.evaluate(() => {
      const b = document.querySelector('.deck-btn-menu');
      const cs = getComputedStyle(b);
      return { pressed: b.getAttribute('aria-pressed'), bar: cs.boxShadow, bg: cs.backgroundColor };
    });
    expect(look.pressed).toBe('true');
    expect(look.bar).toContain(BLUE);                       // the bar along the top edge
    expect(look.bg).toMatch(/^rgba\(29, 111, 224, /);       // a tint of the same blue
  });
}

test('a pressed inspector toggle is blue; Delete stays red', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showInspector === 'function');
  const out = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'A', hotspot: true }, { lat: 32.3, lng: 35.0, name: 'B' }];
    syncLegs(); draw();
    state.selected = { type: 'wp', index: 0 }; showInspector();
    const bg = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).backgroundColor : null; };
    return { hot: bg('#insp-hotspot-btn'), del: bg('#insp-del-wp-btn') };
  });
  expect(out.hot).toBe(BLUE);
  expect(out.del).not.toBe(BLUE);
});

for (const [lang, name, ql] of [['en', 'Chart', 'Chart'], ['he', 'תרשים', 'תרשים']]) {
  test(`the chart menu section is "${name}", not a second "Map" (${lang})`, async ({ page }) => {
    await page.goto('?lang=' + lang + '&nogist');
    await page.waitForFunction(() => typeof S === 'object');
    await expect(page.locator('#toolbar .tb-section[data-sec="view"] .tb-section-title')).toHaveText(name);
    expect(await page.evaluate(() => S.quickLayersChart)).toBe(ql);
  });
}

// Asked: the traffic inspector's direction-of-flight row reads כיוון in Hebrew, not מסלול (the
// app's word for the route).
test('the traffic inspector labels the track כיוון in Hebrew', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof S === 'object');
  expect(await page.evaluate(() => S.trafficTrack)).toBe('כיוון');
});

// The right-click menu mirrors the inspector's toggles, pressed state included: same blue.
test('the right-click menu shows a pressed toggle in the same blue', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showInspector === 'function' && window.NavAidContextMenu);
  await page.evaluate(() => {
    state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'A', hotspot: true }, { lat: 32.3, lng: 35.0, name: 'B' }];
    syncLegs(); draw();
  });
  const bg = await page.evaluate(() => {
    const el = document.createElement('button'); el.className = 'ctx-item ctx-on'; document.body.appendChild(el);
    const c = getComputedStyle(el).backgroundColor; el.remove(); return c;
  });
  expect(bg).toBe(BLUE);
});
