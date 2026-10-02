// @ts-check
// A zoomed-out chart was a carpet of fixed-size triangles and squares (reported with a z8
// screenshot). Chart symbols can now shrink as the map zooms out, and each layer -- airfields,
// reporting points, VORs, frequency changes -- can hide below a zoom of its own, like the
// labels already did. Both are tune keys (gist / tuning panel); the defaults change nothing.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof symbolZoomScale === 'function' && typeof setTune === 'function'
    && typeof hitVorMarkerCandidates === 'function');
}

test('by default every symbol is full size and every layer shows, at every zoom', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => [6, 8, 10, 13].map(z => {
    map.setZoom(z, { animate: false });
    return { s: symbolZoomScale(), shown: ['airfieldMinZoom', 'navWpMinZoom', 'vorMinZoom', 'commChangeMinZoom'].every(layerShownAtZoom) };
  }));
  for (const g of got) { expect(g.s).toBe(1); expect(g.shown).toBe(true); }
});

test('symbols shrink between the two zooms, and the tap area shrinks with them', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    setTune('symbolScaleSmallest', 0.5);
    setTune('symbolScaleMinZoom', 8);
    setTune('symbolScaleFullZoom', 12);
    const at = (z) => { map.setZoom(z, { animate: false }); return symbolZoomScale(); };
    const v = vors[0];
    // Where a VOR's edge would be hit at full size but not at half size.
    const hitAt = (z) => {
      map.setView([v.lat, v.lng], z, { animate: false });
      const c = map.latLngToContainerPoint([v.lat, v.lng]);
      const r = tune('vorMarkerRadiusPx') + tune('hitWaypointExtraPx') - 1;
      return hitVorMarkerCandidates(c.x + r, c.y).length > 0;
    };
    return { z6: at(6), z8: at(8), z10: at(10), z12: at(12), z14: at(14), hitFull: hitAt(12), hitSmall: hitAt(8) };
  });
  expect(got.z6).toBeCloseTo(0.5);
  expect(got.z8).toBeCloseTo(0.5);
  expect(got.z10).toBeCloseTo(0.75);
  expect(got.z12).toBe(1);
  expect(got.z14).toBe(1);
  expect(got.hitFull).toBe(true);
  expect(got.hitSmall).toBe(false);
});

test('a layer hidden below its zoom is neither drawn nor tappable there', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(() => {
    setTune('vorMinZoom', 10);
    const v = vors[0];
    const probe = (z) => {
      map.setView([v.lat, v.lng], z, { animate: false });
      let drawn = 0;
      const orig = window.drawVorSymbol;
      // eslint-disable-next-line no-global-assign
      drawVorSymbol = (...a) => { drawn++; return orig(...a); };
      try { drawVors(); } finally { drawVorSymbol = orig; }
      const c = map.latLngToContainerPoint([v.lat, v.lng]);
      return { drawn, hit: hitVorMarkerCandidates(c.x, c.y).length };
    };
    return { z9: probe(9), z10: probe(10) };
  });
  expect(got.z9).toEqual({ drawn: 0, hit: 0 });
  expect(got.z10.drawn).toBeGreaterThan(0);
  expect(got.z10.hit).toBeGreaterThan(0);
});
