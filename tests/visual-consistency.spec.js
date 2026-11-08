// @ts-check
// UI review batch 5: visual consistency. One state is one colour, a surface that carries text is
// opaque, the Print / Display menus read as controls in columns, the offline window wears the
// shared buttons, and the phone keeps its language button and reaches Terms / Privacy / About.
const { test, expect } = require('./_setup');
const { showToolbarControl } = require('./_toolbar');

async function boot(page, lang = 'en', theme = 'dark') {
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => window.NavAid && NavAid.refreshMobileDeck && typeof draw === 'function'
    && Array.isArray(window.airfields) && airfields.length > 0);
  await page.evaluate(t => {
    document.getElementById('boot-loading')?.remove();
    document.body.classList.remove('theme-dark', 'theme-light'); document.body.classList.add('theme-' + t);
  }, theme);
}
const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const rgb = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
const alpha = s => { const m = s.match(/[\d.]+/g) || []; return m.length > 3 ? Number(m[3]) : 1; };

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('"on" is the toolbar blue and live is one green', async ({ page }) => {
    await boot(page);
    const r = await page.evaluate(() => {
      const on = getComputedStyle(document.documentElement).getPropertyValue('--navaid-mapbtn-on').trim();
      const live = getComputedStyle(document.documentElement).getPropertyValue('--navaid-mapbtn-live').trim();
      const b = document.createElement('button'); b.className = 'atc-fab active'; document.body.appendChild(b);
      const bg = getComputedStyle(b).backgroundColor; b.remove();
      return { on, live, bg };
    });
    expect(r.on.toLowerCase()).toBe('#1d6fe0');
    expect(r.bg).toBe('rgb(31, 138, 76)');   // = --navaid-mapbtn-live
    expect(r.live.toLowerCase()).toBe('#1f8a4c');
  });

  for (const theme of ['dark', 'light']) test(`map clock follows the ${theme} theme and its track holds 3:1 (${theme})`, async ({ page }) => {
    await boot(page, 'en', theme);
    const r = await page.evaluate(() => {
      const cs = (sel, pseudo) => getComputedStyle(document.querySelector(sel), pseudo);
      const slider = document.getElementById('map-time-slider');
      return { read: cs('#map-time-read').backgroundColor, now: cs('#map-time-now').backgroundColor,
        pill: cs('#map-time-slider').backgroundColor,
        // the drawn track's colour is a custom property (pseudo-elements are not readable)
        track: getComputedStyle(slider).getPropertyValue('--mt-track').trim() };
    });
    const dark = theme === 'dark';
    for (const bg of [r.read, r.now]) expect(lum(rgb(bg)) < 0.2, bg).toBe(dark);
    const track = [1, 3, 5].map(i => parseInt(r.track.slice(i, i + 2), 16));
    expect(ratio(track, rgb(r.pill))).toBeGreaterThanOrEqual(3);
  });

  for (const theme of ['dark', 'light']) test(`inspector, windows and the collapsed legend are opaque (${theme})`, async ({ page }) => {
    await boot(page, 'en', theme);
    const a = await page.evaluate(() => {
      const modal = document.createElement('div'); modal.className = 'modal'; document.body.appendChild(modal);
      const legend = document.getElementById('map-legend'); legend.classList.add('map-legend-collapsed');
      const out = { inspector: getComputedStyle(document.getElementById('inspector')).backgroundColor,
        modal: getComputedStyle(modal).backgroundColor, legend: getComputedStyle(legend).backgroundColor };
      modal.remove(); return out;
    });
    for (const [k, v] of Object.entries(a)) expect(alpha(v), k + ' ' + v).toBe(1);
  });

  for (const lang of ['en', 'he']) test(`Print page sizes look like buttons, the orientation one is drawn and named (${lang})`, async ({ page }) => {
    await boot(page, lang, 'dark');
    await showToolbarControl(page, '#page-a3');
    const r = await page.evaluate(() => {
      const st = id => { const c = getComputedStyle(document.getElementById(id)); return { border: c.borderTopColor, bg: c.backgroundColor }; };
      const o = document.getElementById('page-orient');
      const lab = document.querySelector('#toolbar .tb-print-label').getBoundingClientRect();
      const first = document.getElementById('page-a3').getBoundingClientRect();
      return { a3: st('page-a3'), a4: st('page-a4'), svg: !!o.querySelector('.page-orient-icon svg'),
        glyph: /[▯▭▮]/.test(o.textContent), word: o.querySelector('.page-orient-label').textContent.trim().length,
        labelTop: lab.top, labelBottom: lab.bottom, btnTop: first.top, btnBottom: first.bottom };
    });
    for (const s of [r.a3, r.a4]) { expect(s.border).not.toBe('rgba(0, 0, 0, 0)'); expect(s.bg).not.toBe('rgba(0, 0, 0, 0)'); }
    expect(r.svg).toBe(true); expect(r.glyph).toBe(false); expect(r.word).toBeGreaterThan(0);
    // The caption sits on the first button row, not between the two rows.
    expect(r.labelTop).toBeGreaterThanOrEqual(r.btnTop - 2);
    expect(r.labelBottom).toBeLessThanOrEqual(r.btnBottom + 2);
  });

  for (const lang of ['en', 'he']) test(`Display: every reset button shares one column (${lang})`, async ({ page }) => {
    await boot(page, lang, 'dark');
    await showToolbarControl(page, '#wp-size');
    const xs = await page.evaluate(() => [...document.querySelectorAll('.tb-section[data-sec="display"] .slider-reset')]
      .map(b => Math.round(b.getBoundingClientRect().right)));
    expect(xs.length).toBeGreaterThan(8);
    expect(new Set(xs).size, xs.join(',')).toBe(1);
  });

  test('Offline maps wears the shared modal buttons and a styled Detail select', async ({ page }) => {
    await boot(page, 'en', 'dark');
    await page.evaluate(() => document.getElementById('offline-tiles-btn').click());
    await page.waitForSelector('.offline-manager-modal button');
    const r = await page.evaluate(() => [...document.querySelectorAll('.offline-manager-actions button')]
      .map(b => getComputedStyle(b).backgroundColor + '|' + getComputedStyle(b).borderTopLeftRadius));
    expect(r.length).toBeGreaterThan(0);
    for (const v of r) { expect(v).not.toContain('rgb(239, 239, 239)'); expect(v).not.toMatch(/\|0px$/); }
  });

  for (const lang of ['en', 'he']) test(`vertical profile: the no-altitude note clears the key (${lang})`, async ({ page }) => {
    await boot(page, lang, 'dark');
    const r = await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.8, name: 'A' }, { lat: 32.4, lng: 35.0, name: 'B' }, { lat: 32.8, lng: 35.2, name: 'C' }];
      state.legs = []; syncLegs();
      state.legs.forEach(l => { l.flightSpeed = 100; delete l.inboundAltitude; });
      const c = document.createElement('canvas'); c.width = 600; c.height = 160;
      const ctx = c.getContext('2d');
      const texts = [];
      const orig = ctx.fillText.bind(ctx);
      ctx.fillText = (t, x, y) => { texts.push({ t, x, y, w: ctx.measureText(t).width, align: ctx.textAlign }); orig(t, x, y); };
      drawVerticalProfile(ctx, 0, 0, 600, 160, {});
      const note = texts.find(q => /2000|ft/.test(q.t) && q.t.length > 12);
      const key = texts.filter(q => ['altitude', 'terrain', 'safe alt', S.profileLegendAlt, S.profileLegendTerrain].includes(q.t));
      return { note, key, hasAssumed: !!note };
    });
    expect(r.hasAssumed, 'note drawn').toBe(true);
    for (const k of r.key) expect(r.note.y >= k.y + 6, `note y ${r.note.y} vs key ${k.y}`).toBe(true);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('Terms, Privacy and About are reachable in the Menu sheet; the simulator is captioned', async ({ page }) => {
    await boot(page, 'en', 'light');
    await page.locator('#deck-bar .deck-btn').nth(1).click();
    const r = await page.evaluate(() => ['about-link', 'privacy-link', 'terms-link'].map(id => {
      const b = document.getElementById(id).getBoundingClientRect(); return [id, b.width, b.height]; })
      .concat([['sim-text', document.querySelector('#sim-trigger .footer-link-text').getBoundingClientRect().width, 20]]));
    for (const [id, w, h] of r) { expect(w, id).toBeGreaterThan(20); expect(h, id).toBeGreaterThanOrEqual(19); }
    for (const [id, , h] of r.slice(0, 3)) expect(h, id).toBeGreaterThanOrEqual(43.5);
  });

  for (const lang of ['en', 'he']) test(`strip while live keeps the language button and a readable route name (${lang})`, async ({ page }) => {
    await boot(page, lang, 'light');
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'DEROR' }, { lat: 32.3, lng: 35.1, name: 'LLHA' }]; syncLegs(); draw();
      window.gpsPositionLive = () => true;
      const ro = document.getElementById('gps-readout'); ro.hidden = false;
      ro.textContent = '105 kt · 402 ft · 29.35″ · 322° · 12 pts · 00:14';
      NavAid.refreshMobileDeck();
    });
    const r = await page.evaluate(() => {
      const l = document.querySelector('.deck-strip-leg'), g = document.querySelector('.deck-strip-lang');
      return { lang: getComputedStyle(g).display, langW: g.getBoundingClientRect().width, legW: l.getBoundingClientRect().width,
        dir: getComputedStyle(l).direction, bidi: getComputedStyle(l).unicodeBidi,
        sub: parseFloat(getComputedStyle(document.querySelector('.deck-strip-sub')).fontSize) };
    });
    expect(r.lang).not.toBe('none');
    expect(r.langW).toBeGreaterThanOrEqual(43.5);
    expect(r.legW).toBeGreaterThanOrEqual(45);      // six characters, not "D.."
    expect(r.dir).toBe('ltr'); expect(r.bidi).toBe('isolate');
    expect(r.sub).toBeGreaterThanOrEqual(12);
  });

  test('Alt pairs: a table wider than the window shows an edge fade', async ({ page }) => {
    await boot(page, 'en', 'dark');
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.0, lng: 34.9, name: 'DEROR' }, { lat: 32.3, lng: 35.1, name: 'LLHA' }]; syncLegs(); draw();
      showAltitudePairsModal();
    });
    await page.waitForSelector('.charts-alt-table-wrap');
    await page.waitForFunction(() => { const w = document.querySelector('.charts-alt-table-wrap'); return w.scrollWidth > w.clientWidth; });
    await page.waitForFunction(() => document.querySelector('.charts-alt-table-wrap').classList.contains('scroll-end')
      || document.querySelector('.charts-alt-table-wrap').classList.contains('scroll-start'));
    const op = await page.evaluate(() => { const w = document.querySelector('.charts-alt-table-wrap');
      return [getComputedStyle(w, '::after').opacity, getComputedStyle(w, '::before').opacity]; });
    expect(op.map(Number).some(v => v > 0)).toBe(true);
  });
});

test('window close glyph is one glyph; Export warning contrast; attribution is LTR', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page, 'he', 'dark');
  const r = await page.evaluate(() => {
    const w = document.createElement('div'); w.id = 'export-page-warn'; document.body.appendChild(w);
    const warn = getComputedStyle(w).color; w.remove();
    return { sim: document.getElementById('sim-modal-close').textContent, atc: document.getElementById('atc-modal-close').textContent,
      attr: document.querySelector('.attrib-body').dir, warn };
  });
  expect(r.sim).toBe('✕'); expect(r.atc).toBe('✕');
  expect(r.attr).toBe('ltr');
  expect(ratio(rgb(r.warn), [42, 38, 38])).toBeGreaterThanOrEqual(4.5);
});
