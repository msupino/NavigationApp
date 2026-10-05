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
  expect(r.near.startsWith(r.ref + ' ')).toBe(true);
  expect(r.milan).toBe('');
  // Beyond 200 NM of the reference, the nearest VOR within range speaks instead.
  const swapped = await page.evaluate(() => {
    NavAid.tuning.vorReadoutMaxNm = 30;
    const ref = vors.find(v => v.ident === 'BGN') || vors[0];
    const south = vors.slice().sort((a, b) => a.lat - b.lat)[0];
    return { text: vorReadoutText(south.lat + 0.05, south.lng), south: south.ident, ref: ref.ident };
  });
  if (swapped.south !== swapped.ref) expect(swapped.text.startsWith(swapped.south + ' ')).toBe(true);
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
