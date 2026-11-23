// @ts-check
// The VOR readout shows the CURRENT VOR: the chosen reference within range, else the nearest
// VOR within range, else nothing -- and on a phone it sits above the coordinate box, not under it.
const { test, expect } = require('./_setup');

async function boot(page, size) {
  if (size) await page.setViewportSize(size);
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof vorReadoutText === 'function' && typeof loadVors === 'function');
  await page.evaluate(async () => { await loadVors(); });
}

test('reference VOR in range; the nearest beyond its range; nothing far from any', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const ref = vors.find(v => v.ident === 'BGN') || vors[0];
    new Function('v', 'vorRef = v')(ref.ident);
    const far = vors.slice().sort((a, b) => b.lat - a.lat)[0];          // the northernmost
    const south = vors.slice().sort((a, b) => a.lat - b.lat)[0];        // the southernmost
    return {
      near: vorReadoutText(ref.lat + 0.1, ref.lng + 0.1),
      milan: vorReadoutText(45.63, 8.72),
      ref: ref.ident, far: far.ident, south: south.ident,
    };
  });
  expect(r.near.text.startsWith(r.ref + ' ')).toBe(true);   // vorReadoutText returns {text, warn, ...}
  expect(r.milan).toBe('');
  // Beyond 200 NM of the reference, the nearest VOR within range speaks instead.
  const swapped = await page.evaluate(() => {
    NavAid.tuning.vorReadoutMaxNm = 30;
    const ref = vors.find(v => v.ident === 'BGN') || vors[0];
    const south = vors.slice().sort((a, b) => a.lat - b.lat)[0];
    return { text: vorReadoutText(south.lat + 0.05, south.lng), south: south.ident, ref: ref.ident };
  });
  if (swapped.south !== swapped.ref) {
    expect((swapped.text && swapped.text.text || '').startsWith(swapped.south + ' ')).toBe(true);
  }
});

// A point beyond the station's PUBLISHED coverage (its ring) still gets a radial/DME -- it is
// geometry -- but the line is marked (warn) so the pilot sees it is not a reading a receiver
// would hold; a point inside coverage is not marked.
test('the readout marks a line beyond the VOR coverage, not one inside it', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(() => {
    const v = vors.find(x => Number.isFinite(x.coverageNm) && x.coverageNm > 0) || vors[0];
    new Function('v', 'vorRef = v')(v.ident);
    // A point ~0.1° off is a few NM out -> inside a typical ring; far south is well beyond it.
    const inside = vorReadoutText(v.lat + 0.1, v.lng + 0.1);
    const nmPerDeg = 60;
    const outLat = v.lat + (v.coverageNm / nmPerDeg) + 0.4;            // comfortably past coverage
    const outside = vorReadoutText(outLat, v.lng);
    return { cov: v.coverageNm, inside, outside };
  });
  expect(r.inside && r.inside.warn).toBe(false);
  expect(r.outside && r.outside.warn).toBe(true);
  expect(r.outside.cov).toBe(r.cov);
  // And setVorReadout draws the caution glyph only for the warned line.
  const dom = await page.evaluate(() => {
    setVorReadout({ text: 'NAT R-088° / 94.1 NM', warn: true, dme: 94.1, cov: 40 },
                  { text: 'ROP R-120° / 20.0 NM', warn: false });
    const divs = Array.from(document.getElementById('vor-readout').children);
    return divs.map(d => ({ warn: d.classList.contains('vor-readout-warn'),
                            mark: (d.querySelector('.vor-readout-mark') || {}).className || '',
                            title: d.title }));
  });
  expect(dom[0].warn).toBe(true);
  expect(dom[0].mark).toMatch(/is-warn/);
  expect(dom[0].title).toMatch(/94\.1 NM.*40 NM/);
  expect(dom[1].warn).toBe(false);
  expect(dom[1].mark).toMatch(/is-blank/);          // no coverage given -> sized slot, no claim
});

// The status slot is the same size in and out of coverage, so the box keeps one width as a
// point crosses a ring (asked: keep the box size; a tick in zone, a warning out).
test('the readout box keeps its width crossing a coverage ring', async ({ page }) => {
  await boot(page);
  const w = await page.evaluate(() => {
    const box = document.getElementById('vor-readout');
    const at = (warn) => {
      setVorReadout({ text: 'NAT R-088° / 34.1 NM', warn, dme: 34.1, cov: 40 });
      return { w: Math.round(box.getBoundingClientRect().width),
               mark: box.querySelector('.vor-readout-mark').className };
    };
    return { inZone: at(false), out: at(true) };
  });
  expect(w.inZone.mark).toMatch(/is-ok/);
  expect(w.out.mark).toMatch(/is-warn/);
  expect(w.out.w).toBe(w.inZone.w);
});

test('on a phone the VOR line sits above the coordinate box, not under it', async ({ page }) => {
  await boot(page, { width: 390, height: 844 });
  const r = await page.evaluate(() => {
    new Function('v', 'vorRef = v')((vors.find(v => v.ident === 'BGN') || vors[0]).ident);
    setVorReadout('BGN R-309° / 12.4 NM');
    const a = document.getElementById('vor-readout').getBoundingClientRect();
    const b = document.getElementById('coord-readout').getBoundingClientRect();
    return { overlap: a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top, above: a.bottom <= b.top + 1 };
  });
  expect(r).toEqual({ overlap: false, above: true });
});

test('VOR ref row: picker then readout at the row\'s far edge, mirrored in Hebrew', async ({ page }) => {
  for (const lang of ['en', 'he']) {
    await page.goto('?lang=' + lang + '&nogist');
    await page.waitForFunction(() => typeof syncLegs === 'function' && typeof showInspector === 'function');
    await page.evaluate(() => {
      state.waypoints = [{ lat: 32.18, lng: 34.83, name: 'A' }, { lat: 32.40, lng: 34.95, name: 'B' }];
      syncLegs(); draw(); state.selected = { type: 'wp', index: 1 }; showInspector();
    });
    const row = page.locator('#inspector .vor-radial-row').first();
    await row.waitFor();
    const g = await row.evaluate((r) => {
      const box = (el) => el.getBoundingClientRect();
      return { row: box(r), lab: box(r.querySelector('label')), sel: box(r.querySelector('select')),
        val: box(r.querySelector('.vor-radial-val')) };
    });
    if (lang === 'en') {
      expect(g.sel.left).toBeLessThan(g.val.left);                       // label · NAT · R-xxx
      expect(g.row.right - g.val.right).toBeLessThan(24);                 // at the far (right) edge
    } else {
      expect(g.sel.right).toBeGreaterThan(g.val.right);                  // mirror: NAT right of the readout
      expect(g.val.left - g.row.left).toBeLessThan(24);                   // at the far (left) edge
    }
  }
});

test('VOR Reference row: at the default inspector width the readout stays inside the panel', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof syncLegs === 'function' && typeof showInspector === 'function');
  await page.evaluate(async () => {
    await loadVors(); window.vorRef = 'NAT'; window.inspectorVorRef = undefined;
    state.waypoints = [{ lat: 32.1025, lng: 34.80361, name: 'ROKCH' }];
    syncLegs(); draw(); state.selected = { type: 'wp', index: 0 }; showInspector();
  });
  const row = page.locator('#inspector .vor-radial-row').first();
  await row.waitFor();
  await expect(row.locator('.vor-radial-val')).toHaveText(/R-\d{3}° \/ \d+\.\d NM/);
  const g = await row.evaluate((r) => ({ row: r.getBoundingClientRect().right,
    val: r.querySelector('.vor-radial-val').getBoundingClientRect().right }));
  expect(g.val).toBeLessThanOrEqual(g.row + 1);
});

// Reported more than once: the status glyph walked a digit left or right as one line's distance
// had fewer digits than the other's ("7.2" vs "47.7"). The distance is padded to a fixed width
// and each line pushes its glyph to the box's edge: the glyphs share one column, and the box
// keeps its width as a distance gains a digit.
test('the status glyphs share a column and the box holds its width across digit counts', async ({ page }) => {
  await boot(page);
  const g = await page.evaluate(() => {
    const nat = { ident: 'NAT', coverageNm: 40 }, rop = { ident: 'ROP', coverageNm: 20 };
    const box = document.getElementById('vor-readout');
    const show = (a, b) => {
      setVorReadout(vorReadoutData(nat, { radial: '041', dme: a }), vorReadoutData(rop, { radial: '142', dme: b }));
      return { xs: [...box.querySelectorAll('.vor-readout-mark')].map(m => Math.round(m.getBoundingClientRect().left)),
               w: Math.round(box.getBoundingClientRect().width) };
    };
    return [show(47.7, 7.2), show(147.7, 17.2), show(4.1, 0.3)];
  });
  for (const s of g) expect(s.xs[0]).toBe(s.xs[1]);            // one column
  expect(g[1].w).toBe(g[0].w);                                  // gaining a digit does not resize
  expect(g[2].w).toBe(g[0].w);
});
