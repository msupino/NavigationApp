// @ts-check
// The LSA (Low Alt) chart's own legend, carried into the app: its frequency-change points
// (black triangle with a magenta dot, 28 of them, read off the chart -- the dataset had none),
// its compulsory points, and its two bubble classes. The map legend shows the rows of the
// chart actually being read.
const { test, expect } = require('./_setup');

async function lowAlt(page) {
  await page.goto('?lang=en&nogist&deck=0');
  await page.waitForFunction(() => typeof draw === 'function' && document.getElementById('layer-select'));
  await page.evaluate(() => {
    const s = document.getElementById('layer-select');
    s.value = 'Low Alt';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => layerDataPrefix() === 'lsa');
  await page.evaluate(async () => { await loadCommChange(); await loadNavWaypoints(); draw(); });
}

test('Low Alt carries the chart\'s frequency-change points, with call signs that resolve', async ({ page }) => {
  await lowAlt(page);
  const got = await page.evaluate(() => {
    const pts = Object.values(commChangeMap);
    return { n: pts.length, unresolved: pts.flatMap(p => p.callSigns.filter(c => !commChangeCallSigns[c])),
      reute: commChangeMap['רעות'] && commChangeMap['רעות'].callSigns };   // keyed by the point's display name
  });
  expect(got.n).toBe(28);
  expect(got.unresolved).toEqual([]);
  expect(got.reute).toEqual(['PLUTO_EAST', 'TEL_NOF']);
});

test('a frequency-change point wears the chart\'s magenta dot, and the setting can take it off', async ({ page }) => {
  await lowAlt(page);
  const count = () => page.evaluate(() => {
    let n = 0;
    const orig = window.drawCommChangeDot;
    // eslint-disable-next-line no-global-assign
    drawCommChangeDot = (...a) => { n++; return orig(...a); };
    try { drawNavWaypoints(); } finally { drawCommChangeDot = orig; }
    return n;
  });
  expect(await count()).toBeGreaterThan(20);
  await page.evaluate(() => setTune('commChangeDot', false));
  expect(await count()).toBe(0);
});

test('the LSA legend rows -- frequency change, the two bubble classes -- show only on the LSA set', async ({ page }) => {
  await lowAlt(page);
  const rows = () => page.evaluate(() => ['legend-row-comm', 'legend-row-lsa-daily', 'legend-row-lsa-weekend']
    .map(id => getComputedStyle(document.getElementById(id)).display !== 'none'));
  expect(await rows()).toEqual([true, true, true]);
  await page.evaluate(() => {
    const s = document.getElementById('layer-select');
    s.value = 'CVFR';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => layerDataPrefix() === 'cvfr');
  await page.evaluate(async () => { commChangeMap = null; await loadCommChange(); draw(); });
  expect(await rows()).toEqual([false, false, false]);   // the card keeps its usual size elsewhere
});
