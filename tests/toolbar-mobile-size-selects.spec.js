// @ts-check
// Two mobile toolbar defects reported from a phone:
//  - the closed menu was four stacked ~50px rows (drag handle, ☰, language, links) and ate a
//    quarter of the screen, when all three controls are small enough to share one row;
//  - a <select>'s native drop-down arrow is painted INSIDE its padding box, and a 4px right
//    padding left it no room, so on iOS Safari the arrow sat on top of the text and
//    "— none —" read as "— non". A long option also pushed its row past the panel edge,
//    because a flex item defaults to min-width:auto and refuses to shrink below its content.
const { test, expect } = require('./_setup');

test.use({ viewport: { width: 375, height: 812 } });

async function boot(page) {
  await page.addInitScript(() => {
    try {
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + s, '1');
    } catch (e) {}
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof state !== 'undefined' &&
    !!document.getElementById('toolbar'));
}

test('the closed menu is one row of controls plus its links, not four stacked rows', async ({ page }) => {
  await boot(page);
  const m = await page.evaluate(() => {
    const tb = document.getElementById('toolbar');
    if (!tb.classList.contains('collapsed')) document.getElementById('toolbar-toggle').click();
    const r = tb.getBoundingClientRect();
    const box = id => {
      const e = document.getElementById(id);
      const b = e.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, mid: (b.top + b.bottom) / 2, h: b.height };
    };
    return { h: r.height, w: r.width, pct: r.height / innerHeight * 100,
      handle: box('toolbar-handle'), toggle: box('toolbar-toggle'),
      lang: box('lang-toggle'), links: box('footer-links'),
      viewportH: innerHeight };
  });
  // Was 203px / 25% of an iPhone screen with nothing on it.
  expect(m.h).toBeLessThan(140);
  expect(m.pct).toBeLessThan(20);
  // The drag handle, the ☰ and the language picker share a row: their vertical centres are
  // within one row of each other rather than stacked one per row.
  expect(Math.abs(m.toggle.mid - m.lang.mid)).toBeLessThan(30);
  expect(Math.abs(m.handle.mid - m.toggle.mid)).toBeLessThan(30);
  // The links keep their own row, below all three.
  expect(m.links.top).toBeGreaterThanOrEqual(m.toggle.bottom - 8);
});

test('the closed menu leaves the map usable and does not overflow the page', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const tb = document.getElementById('toolbar');
    if (!tb.classList.contains('collapsed')) document.getElementById('toolbar-toggle').click();
    const b = tb.getBoundingClientRect();
    return { right: b.right, viewportW: innerWidth,
      docOverflow: document.documentElement.scrollWidth - innerWidth };
  });
  expect(r.right).toBeLessThanOrEqual(r.viewportW);
  expect(r.docOverflow).toBe(0);
});

// --- the selects -------------------------------------------------------------------
// The toolbar sections are an ACCORDION: opening one closes the rest, so only the selects of
// one section are ever laid out. Walk the sections and collect from each in turn.
async function eachSectionSelects(page, collect) {
  return page.evaluate(async fnBody => {
    const measure = new Function('return (' + fnBody + ')')();
    const tb = document.getElementById('toolbar');
    if (tb.classList.contains('collapsed')) document.getElementById('toolbar-toggle').click();
    await new Promise(r => setTimeout(r, 120));
    const out = [];
    for (const sec of document.querySelectorAll('#toolbar .tb-section')) {
      const head = sec.querySelector('.tb-section-head');
      if (!head) continue;
      if (!sec.classList.contains('open')) head.click();
      await new Promise(r => setTimeout(r, 120));
      for (const sel of sec.querySelectorAll('.navtoggle select')) {
        if (sel.getBoundingClientRect().height === 0) continue;
        out.push(measure(sel, tb));
      }
    }
    return out;
  }, collect.toString());
}

test('every toolbar select reserves room for its arrow', async ({ page }) => {
  await boot(page);
  const sels = await eachSectionSelects(page, (sel) => {
    const cs = getComputedStyle(sel);
    return { id: sel.id, padR: parseFloat(cs.paddingRight),
      chevron: /svg/.test(cs.backgroundImage), ellipsis: cs.textOverflow,
      minW: parseFloat(cs.minWidth) || 0 };
  });
  // Several sections carry one, so a single result would mean the walk failed.
  expect(sels.length).toBeGreaterThan(2);
  for (const s of sels) {
    // The arrow needs space of its own, whoever draws it. 4px was not enough, and on iOS the
    // native glyph landed on the last characters of the value.
    expect(s.padR, s.id + ' has no room for its arrow').toBeGreaterThanOrEqual(16);
    expect(s.chevron, s.id + ' lost its chevron').toBe(true);
    expect(s.ellipsis, s.id).toBe('ellipsis');
    // min-width:auto is what stopped a long value shrinking inside its row.
    expect(s.minW, s.id + ' cannot shrink').toBe(0);
  }
});

test('no select is cut off by the panel edge, in either language', async ({ page }) => {
  for (const lang of ['en', 'he']) {
    await page.addInitScript(() => {
      try {
        for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
          localStorage.setItem('navaid.sec.' + s, '1');
      } catch (e) {}
    });
    await page.goto('?lang=' + lang + '&nogist');
    await page.waitForFunction(() => !!document.getElementById('toolbar'));
    const sels = await eachSectionSelects(page, (sel, tb) => {
      const b = sel.getBoundingClientRect(), p = tb.getBoundingClientRect();
      return { id: sel.id, overRight: Math.round(b.right - p.right),
        overLeft: Math.round(p.left - b.left) };
    });
    expect(sels.length).toBeGreaterThan(2);
    // "Nav waypoints from" hung 12px past the edge, so its arrow was clipped away entirely.
    const over = sels.filter(s => s.overRight > 0 || s.overLeft > 0);
    expect(over, 'selects overflowing the panel in ' + lang).toEqual([]);
  }
});

test('the chevron is drawn in the theme\'s ink, both ways', async ({ page }) => {
  await boot(page);
  const inks = await page.evaluate(async () => {
    const tb = document.getElementById('toolbar');
    if (tb.classList.contains('collapsed')) document.getElementById('toolbar-toggle').click();
    await new Promise(r => setTimeout(r, 120));
    // #lang-select is outside the accordion, so it is laid out without opening a section.
    const sel = document.getElementById('lang-select');
    const read = () => {
      const bg = decodeURIComponent(getComputedStyle(sel).backgroundImage);
      return { hasSvg: /svg/.test(bg), stroke: (bg.match(/stroke='(#[0-9a-fA-F]{6})'/) || [])[1] };
    };
    const wasLight = document.body.classList.contains('theme-light');
    document.body.classList.remove('theme-light');
    await new Promise(r => setTimeout(r, 50));
    const dark = read();
    document.body.classList.add('theme-light');
    await new Promise(r => setTimeout(r, 50));
    const light = read();
    if (!wasLight) document.body.classList.remove('theme-light');
    return { dark, light };
  });
  expect(inks.dark.hasSvg).toBe(true);
  expect(inks.light.hasSvg).toBe(true);
  // The light-theme rule has to come AFTER the shared light input rule, which sets the
  // `background` SHORTHAND and so resets background-image — declared earlier, the select
  // rendered with no arrow at all.
  expect(inks.dark.stroke).not.toBe(inks.light.stroke);
});
