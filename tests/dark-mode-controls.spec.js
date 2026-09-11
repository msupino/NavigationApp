// @ts-check
// Every control in NavAid paints itself, because a <select> left to the browser is light
// grey with black text whatever the app is wearing: fine in the light theme, a bright
// rectangle punched through the dark one. Two had been missed -- the PWX level picker in
// Extra layers, and the Show filter in the saved-route library -- so this checks the whole
// set rather than those two, and will notice the next one that is added without styling.
const { test, expect } = require('./_setup');

async function boot(page, theme) {
  await page.addInitScript((t) => { try { localStorage.setItem('navaid.theme', t); } catch (e) {} }, theme);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showRouteLibraryModal === 'function'
    && document.body.classList.contains('theme-dark') || document.body.classList.contains('theme-light'));
  // The surfaces that own dropdowns, including two that are only built when opened.
  await page.evaluate(() => {
    persistRouteLibrary([{ id: 'r1', name: 'x', savedAt: new Date().toISOString(),
      data: { waypoints: [{ lat: 32, lng: 34.9, name: 'A' }, { lat: 32.2, lng: 35, name: 'B' }],
        legs: [{}], notes: [] } }]);
    showRouteLibraryModal();
    const modal = document.createElement('div');
    modal.className = 'modal sigwx-modal';
    const sel = document.createElement('select');
    sel.className = 'sigwx-time';
    modal.appendChild(sel);
    document.body.appendChild(modal);
  });
}

// The frequency table is its own chart modal, and opening one closes another -- so it gets
// its own boot rather than joining the sweep above.
async function bootFreqTable(page, theme) {
  await page.addInitScript((t) => { try { localStorage.setItem('navaid.theme', t); } catch (e) {} }, theme);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showFreqTableModal === 'function');
  await page.evaluate(() => showFreqTableModal());
  // Its aerodrome filter is built only once the rows are in, and only when they cover more
  // than one field.
  await page.waitForSelector('.charts-freq-filter-sel', { state: 'attached', timeout: 10000 })
    .catch(() => { /* no frequency data in this run */ });
}

const readSelects = (page) => page.evaluate(() => {
  const rgb = (c) => { const m = String(c).match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : [0, 0, 0]; };
  const lum = (c) => {
    const [r, g, b] = rgb(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  return [...document.querySelectorAll('select')].map(s => {
    const cs = getComputedStyle(s);
    // A transparent background takes the panel's, which is the theme's by definition.
    const clear = /rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor);
    return { id: s.id || s.className, light: !clear && lum(cs.backgroundColor) > 0.5,
             clear, contrast: contrast(cs.backgroundColor, cs.color) };
  });
});

for (const [theme, wantLight] of [['dark', false], ['light', true]]) {
  test('every dropdown wears the ' + theme + ' theme', async ({ page }) => {
    await boot(page, theme);
    const rows = await readSelects(page);
    expect(rows.length).toBeGreaterThan(10);
    const wrong = rows.filter(r => !r.clear && r.light !== wantLight).map(r => r.id);
    expect(wrong, 'these dropdowns kept the browser default').toEqual([]);
  });

  test('and is readable in ' + theme, async ({ page }) => {
    await boot(page, theme);
    const rows = await readSelects(page);
    // WCAG AA for normal text is 4.5:1. These are controls a pilot reads in daylight.
    const poor = rows.filter(r => !r.clear && r.contrast < 4.5).map(r => r.id + ' ' + r.contrast.toFixed(1));
    expect(poor).toEqual([]);
  });
}

test('the frequency table filter matches the box it filters with', async ({ page }) => {
  await bootFreqTable(page, 'dark');
  const got = await page.evaluate(() => {
    const sel = document.querySelector('.charts-freq-filter-sel');
    const box = document.querySelector('.charts-freq-search');
    if (!sel || !box) return null;
    const a = getComputedStyle(sel), b = getComputedStyle(box);
    return { selBg: a.backgroundColor, boxBg: b.backgroundColor, selSize: a.fontSize, boxSize: b.fontSize };
  });
  test.skip(!got, 'no frequency rows in this run');
  // It sits directly beside the search input; two controls on one line that disagree about
  // what colour a control is read as two different kinds of thing.
  expect(got.selBg).toBe(got.boxBg);
  expect(got.selSize).toBe(got.boxSize);
});

test('the two that were missed keep their own size', async ({ page }) => {
  await boot(page, 'dark');
  // `font: inherit` in the shared rule resets size too, so each states its own after it.
  // Without that the SIGWX viewer's 13px silently became the inherited 16px.
  const sizes = await page.evaluate(() => ({
    filter: getComputedStyle(document.querySelector('.route-library-filter-select')).fontSize,
    pwx: getComputedStyle(document.getElementById('ims-pwx-level')).fontSize,
    sigwx: getComputedStyle(document.querySelector('.sigwx-modal .sigwx-time')).fontSize,
    toolbar: getComputedStyle(document.querySelector('#toolbar .navtoggle select')).fontSize,
  }));
  expect(sizes.sigwx).toBe('13px');
  expect(sizes.filter).toBe('12px');
  // The PWX picker sits among the toolbar's own selects and matches them.
  expect(sizes.pwx).toBe(sizes.toolbar);
});
