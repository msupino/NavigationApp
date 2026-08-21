// @ts-check
// The airport-charts menu used to label every plate from its file name ("airport Annex
// Alef") — our storage convention, not what the plate is called. A pilot looking for the
// radio-failure joining chart had to know it is Annex Daled at Rosh Pina and Annex Yud Gimel
// at Herzliya. The rows now carry the CAA's own designation, from docs/data/plate-titles.json
// (written by scripts/aip-plate-titles.mjs, which matches our PDFs to the CAA index by hash).
const { test, expect } = require('./_setup');

async function openCharts(page, lang) {
  await page.goto(`?lang=${lang}&nogist`);
  await page.waitForFunction(() => typeof showChartsModal === 'function');
  await page.evaluate(() => showChartsModal('LLIB'));
  await page.waitForSelector('.charts-airport[data-icao="LLIB"] .plate-row');
}

const rows = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.charts-airport[data-icao="LLIB"] .plate-row')].map(r => ({
    annex: (r.querySelector('.plate-annex') || {}).textContent || '',
    title: (r.querySelector('.plate-row-title') || {}).textContent || '',
    amd: (r.querySelector('.plate-row-amd') || {}).textContent || '',
  })));

test('a Hebrew session shows the CAA designation, not the file name', async ({ page }) => {
  await openCharts(page, 'he');
  const list = await rows(page);
  expect(list.length).toBeGreaterThan(5);
  const commfail = list.find(r => /תקלת קשר/.test(r.title));
  expect(commfail).toBeTruthy();
  expect(commfail.annex).toBe("ד'");            // the letter alone: every badge says נספח
  expect(commfail.title).toContain('הצטרפות');
  // The file name must not leak through for a plate the index knows.
  expect(list.every(r => !/airport|Annex [A-Z]/.test(r.title))).toBe(true);
});

test('the date the plate was last amended is on the row, and reads the same way round in Hebrew', async ({ page }) => {
  await openCharts(page, 'he');
  const list = await rows(page);
  const chart = list.find(r => r.annex === "א'");
  expect(chart).toBeTruthy();
  // 2026-08, not "8/26": that reads as an amendment NUMBER, which this is not, and bidi turned
  // it round into "21/8" in a Hebrew line.
  expect(chart.amd).toMatch(/^\d{4}-\d{2}$/);
  expect(await page.evaluate(() =>
    document.querySelector('.charts-airport[data-icao="LLIB"] .plate-row-amd').dir)).toBe('ltr');
});

// Reported: a Hebrew session read "LLIB — Rosh Pina / Mahanayim" for a field the pilot calls
// ראש פינה.
test('the airfield header leads with the name in the interface language', async ({ page }) => {
  await openCharts(page, 'he');
  const head = await page.evaluate(() => {
    const h = document.querySelector('.charts-airport[data-icao="LLIB"] .charts-airport-header');
    return { name: h.querySelector('.charts-airport-name').textContent,
             code: h.querySelector('.charts-airport-code').textContent };
  });
  expect(head.name).toBe('ראש פינה');
  expect(head.code).toBe('LLIB');
});

test('an English session leads with the English name', async ({ page }) => {
  await openCharts(page, 'en');
  const name = await page.evaluate(() =>
    document.querySelector('.charts-airport[data-icao="LLIB"] .charts-airport-name').textContent);
  expect(name).toMatch(/Rosh Pina/);
});

// The domestic AIP is Hebrew-only, so an English session still gets the Hebrew designation —
// it is what the plate is called and what a controller will say.
test('an English session falls back to the Hebrew designation where there is no English', async ({ page }) => {
  await openCharts(page, 'en');
  const list = await rows(page);
  expect(list.find(r => /תקלת קשר/.test(r.title))).toBeTruthy();
});

// A plate the index does not know (one we ship that the CAA has since amended) still has to
// appear, labelled the old way rather than blank.
test('an unknown plate keeps its file-name label', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof plateDesignation === 'function');
  const out = await page.evaluate(async () => {
    await loadPlateTitles();
    return plateDesignation('LLXX_airport_Annex Zzz.pdf');
  });
  expect(out.title).toBe('airport Annex Zzz');
  expect(out.annex).toBe('');
});

// The designations come off the network and end up in a checked-in file, a workflow step
// summary and a button in the cockpit. CodeQL flagged that path, and it is right to: the
// script treats the index as text and nothing else.
test('the shipped designations carry no control, bidi or markdown characters', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof loadPlateTitles === 'function');
  const bad = await page.evaluate(async () => {
    const titles = await loadPlateTitles();
    const ctrl = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]');
    const markup = new RegExp('[`*_<>|\\\\]');
    const out = [];
    for (const [file, row] of Object.entries(titles)) {
      for (const key of ['annex', 'he', 'en']) {
        const v = row[key];
        if (typeof v !== 'string') { out.push(file + '.' + key + ' is not a string'); continue; }
        if (ctrl.test(v)) out.push(file + '.' + key + ' control/bidi');
        if (markup.test(v)) out.push(file + '.' + key + ' markup');
        if (v.length > 120) out.push(file + '.' + key + ' too long');
      }
      if (row.modified && !/^\d{4}-\d{2}-\d{2}$/.test(row.modified)) out.push(file + '.modified');
    }
    return out;
  });
  expect(bad).toEqual([]);
});

// Reported: "the menu itself is not usable ... bigger buttons, not >". It was a scrolling
// column of collapsed sections with a chevron each — a lot of small targets between the pilot
// and the chart. Two screens now, the way every plate app a pilot already uses does it: pick
// the field, then its plates.
test.describe('the charts menu is two screens, not twenty accordions', () => {
  const open = async (page, lang) => {
    await page.goto(`?lang=${lang || 'he'}&nogist`);
    await page.waitForFunction(() => typeof showChartsModal === 'function');
    await page.evaluate(() => showChartsModal());
    await page.waitForSelector('.charts-fields-grid .charts-field');
  };

  test('it opens on a grid of fields, with no accordions to expand', async ({ page }) => {
    await open(page);
    expect(await page.locator('.charts-field').count()).toBeGreaterThan(3);
    await expect(page.locator('.charts-airport-body')).toHaveCount(0);
    // Every tile is a thumb-sized target, not a line of text with a chevron.
    const box = await page.locator('.charts-field').first().boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(56);
  });

  test('a tile opens that field and only that field, with a way back', async ({ page }) => {
    await open(page);
    await page.locator('.charts-field[data-icao="LLIB"]').click();
    await expect(page.locator('.charts-airport[data-icao="LLIB"] .plate-row').first()).toBeVisible();
    await expect(page.locator('.charts-fields-grid')).toHaveCount(0);
    await page.locator('.charts-back').click();
    await expect(page.locator('.charts-fields-grid')).toBeVisible();
  });

  test('the filter finds a field by its Hebrew name or its code', async ({ page }) => {
    await open(page);
    await page.fill('#charts-filter', 'ראש');
    await expect(page.locator('.charts-field[data-icao="LLIB"]')).toBeVisible();
    expect(await page.locator('.charts-field').count()).toBeLessThan(4);
    await page.fill('#charts-filter', 'llhz');
    await expect(page.locator('.charts-field[data-icao="LLHZ"]')).toBeVisible();
  });

  // The fields this flight touches come first: a pilot opening this mid-planning wants them,
  // not an alphabetical hunt.
  test('the route’s own fields are listed first', async ({ page }) => {
    await page.goto('?lang=he&nogist');
    await page.waitForFunction(() => typeof showChartsModal === 'function');
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'LLHZ' }, { lat: 32.98, lng: 35.57, name: 'LLIB' }];
      syncLegs();
      showChartsModal();
    });
    await page.waitForSelector('.charts-fields-grid .charts-field');
    const first = await page.evaluate(() =>
      [...document.querySelectorAll('.charts-fields-grid')][0].querySelectorAll('.charts-field').length);
    const label = await page.locator('.charts-fields-label').first().textContent();
    expect(label).toContain('במסלול');
    expect(first).toBe(2);
  });
});

// The charts panel is read on a kneeboard in daylight as often as at night.
test('the menu follows the light theme', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof showChartsModal === 'function');
  const out = await page.evaluate(async () => {
    document.body.classList.add('theme-light');
    showChartsModal();
    await new Promise(r => setTimeout(r, 400));
    const tile = document.querySelector('.charts-field');
    const cs = getComputedStyle(tile);
    const lum = (rgb) => {
      const [r, g, b] = rgb.match(/\d+/g).map(Number);
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    };
    return { bg: lum(cs.backgroundColor), fg: lum(cs.color) };
  });
  expect(out.bg).toBeGreaterThan(0.8);     // a light tile...
  expect(out.fg).toBeLessThan(0.35);       // ...with dark text on it
});

// Annexes run א, ב, ג … י, יא, יב. A string sort puts יא before ב, and the annex number is
// what a pilot asks for by name.
test('plates are listed in annex order', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof showChartsModal === 'function');
  await page.evaluate(() => showChartsModal('LLHZ'));
  await page.waitForSelector('.charts-airport[data-icao="LLHZ"] .plate-row');
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('.charts-airport[data-icao="LLHZ"] .plate-annex')]
      .map(b => b.textContent).filter(Boolean));
  const rank = await page.evaluate((list) => list.map(a => annexOrder(a)), order);
  expect(rank).toEqual([...rank].sort((a, b) => a - b));
  // Hebrew numerals, not letters in Unicode order: יא is eleven, and its parts sort after it.
  expect(order.join(' ')).toContain("י' יא' יא'-1 יא'-2 יב'");
});

// Reported twice, on two different buttons: an inspector control styled light unconditionally
// is a white slab in a black panel. These are the panel's own buttons, so they follow the
// panel's theme.
test('inspector buttons follow the dark theme', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof showInspector === 'function' && Array.isArray(window.airfields));
  const out = await page.evaluate(async () => {
    document.body.classList.remove('theme-light');
    document.body.classList.add('theme-dark');
    if (!window.airfields || !window.airfields.length) await loadAirfields();
    const af = airfields.find(a => a.plates && a.plates.length);
    state.waypoints = [{ lat: af.lat, lng: af.lng, name: af.name }];
    syncLegs();
    state.selected = { type: 'wp', index: 0 };
    showInspector();
    const lum = (rgb) => {
      const m = rgb.match(/\d+/g).map(Number);
      return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255;
    };
    const read = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { bg: lum(cs.backgroundColor), fg: lum(cs.color) };
    };
    return { charts: read('.insp-charts-btn'), safe: read('.insp-btn.insp-btn-safe') };
  });
  for (const [name, v] of Object.entries(out)) {
    if (!v) continue;
    expect(v.bg, `${name} background`).toBeLessThan(0.6);   // a dark surface...
    expect(v.fg, `${name} text`).toBeGreaterThan(0.5);      // ...with light text on it
  }
});

// Reported: at a field with many plates the list scrolls and the way back goes with it.
test('the back button stays on screen while the plates scroll', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 640 });
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof showChartsModal === 'function');
  await page.evaluate(() => showChartsModal('LLBG'));
  await page.waitForSelector('.charts-airport[data-icao="LLBG"] .plate-row');
  const sticky = await page.evaluate(() => getComputedStyle(document.querySelector('.charts-field-bar')).position);
  expect(sticky).toBe('sticky');
  const before = await page.locator('.charts-back').boundingBox();
  await page.evaluate(() => {
    const sc = document.querySelector('.fp-scroll');
    sc.scrollTop = sc.scrollHeight;
  });
  await page.waitForTimeout(150);
  const after = await page.locator('.charts-back').boundingBox();
  expect(after).not.toBeNull();
  // It has not scrolled away with the list.
  expect(Math.abs(after.y - before.y)).toBeLessThan(8);
});

// Reported: closing a NOTAM opened from an airfield's inspector took the inspector with it.
// The modal's own Escape handler removed it, and the same keypress then reached the window
// handler, which — finding no modal left — cleared the selection underneath.
test('Escape on a NOTAM closes the NOTAM and leaves the inspector', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showNotamModal === 'function'
    && Array.isArray(window.airfields) && window.airfields.length > 0);
  const out = await page.evaluate(() => {
    const insp = document.getElementById('inspector');
    state.selected = { type: 'airfield', index: airfields.findIndex(a => a.plates && a.plates.length) };
    showInspector();
    showNotamModal([{ icao: 'LLIB', id: 'A1/26', raw: 'X', text: 'x' }]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { inspectorHidden: insp.classList.contains('hidden'),
             stillSelected: !!state.selected,
             modals: document.querySelectorAll('.modal-back').length };
  });
  expect(out.modals).toBe(0);              // the NOTAM went
  expect(out.inspectorHidden).toBe(false); // the inspector stayed
  expect(out.stillSelected).toBe(true);
});

// A second Escape, with nothing on top, is the one that closes the inspector.
test('a second Escape then closes the inspector', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof showInspector === 'function'
    && Array.isArray(window.airfields) && window.airfields.length > 0);
  const hidden = await page.evaluate(() => {
    const insp = document.getElementById('inspector');
    state.selected = { type: 'airfield', index: 0 };
    showInspector();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return insp.classList.contains('hidden');
  });
  expect(hidden).toBe(true);
});

// Reported: the written pages showed as "airport Chart" in a Hebrew session. Their titles
// carry no annex number ("מנחת באר-שבע - LLBS - דפי מלל"), and they hang under grouping nodes
// rather than under each field, so neither the hash nor the annex key found them — and the
// row fell back to the file name.
test('the written pages are named, not left as a file name', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof loadPlateTitles === 'function');
  const out = await page.evaluate(async () => {
    await loadPlateTitles();
    const files = ['LLHZ_airport_Chart.pdf', 'LLHA_airport_Chart.pdf', 'LLBO_airport_Chart.pdf',
                   'LLEY_airport_Chart.pdf', 'LLFK_airport_Chart.pdf', 'LLKS_airport_Chart.pdf',
                   'LLMZ_airport_Chart.pdf', 'LLBS_airport_Chart.pdf'];
    return files.map(f => ({ f, title: plateDesignation(f).title }));
  });
  for (const row of out) {
    expect(row.title, row.f).toMatch(/מלל/);
    expect(row.title, row.f).not.toMatch(/airport|Chart/i);
  }
});

test('a field with only written pages still shows them in the menu', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof showChartsModal === 'function');
  await page.evaluate(() => showChartsModal('LLHZ'));
  await page.waitForSelector('.charts-airport[data-icao="LLHZ"] .plate-row');
  const titles = await page.evaluate(() =>
    [...document.querySelectorAll('.charts-airport[data-icao="LLHZ"] .plate-row-title')]
      .map(t => t.textContent));
  expect(titles.some(t => /מלל/.test(t))).toBe(true);
  expect(titles.some(t => /airport/i.test(t))).toBe(false);
});
