// @ts-check
// Profiled on a phone (CPU / 4): a 90 degree turn of the dial took 12-14 s, with the vector
// renderer resized and repainted on every frame (leaflet-rotate: rotate -> _update) and every
// offline world label's transform rewritten on every frame. The JavaScript share of a turn
// halved once both stopped. These pin the mechanisms, not timings.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof map !== 'undefined' && map.setBearing && !document.getElementById('boot-loading'));
}

test('a turn repaints the vector renderers once it settles, not on every frame', async ({ page }) => {
  await boot(page);
  const n = await page.evaluate(async () => {
    const rs = new Set();
    map.eachLayer(l => { if (l instanceof L.Renderer) rs.add(l); });
    let calls = 0;
    for (const r of rs) { const orig = r._update; r._update = function () { calls++; return orig.apply(this, arguments); }; }
    await new Promise(r => setTimeout(r, 1600));            // clear of any earlier repaint
    calls = 0;
    // A burst of turn steps, as fast as a dial drag sends them: nothing repaints yet...
    for (let a = 0; a <= 90; a += 3) map.setBearing(a);
    const during = calls;
    // ...and once the turn settles, each renderer repaints once.
    await new Promise(r => setTimeout(r, 700));
    return { renderers: rs.size, during, settled: calls };
  });
  expect(n.renderers).toBeGreaterThan(0);
  expect(n.during).toBe(0);
  expect(n.settled).toBe(n.renderers);
});

test('the world labels turn by one variable, not one transform each', async ({ page }) => {
  await boot(page);
  await page.waitForFunction(() => document.querySelector('.world-label'));
  const r = await page.evaluate(() => {
    const el = document.querySelector('.world-label');
    const before = el.style.transform;
    map.setBearing(30);
    const pane = el.parentElement;
    return { before, after: el.style.transform, turn: pane.style.getPropertyValue('--world-turn') };
  });
  expect(r.after).toBe(r.before);                 // untouched by the turn
  expect(r.after).toContain('var(--world-turn');
  expect(parseFloat(r.turn)).toBeCloseTo(-30, 6);
});
