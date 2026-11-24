// @ts-check
// Asked: "Clear route button should remove vor references". Per-leg VOR picks went with
// state.legs, but the global VOR 1 / VOR 2 references survived Clear map, so the next route read
// radials and DME off stations chosen for the last flight. And with only a reference set, the
// button stayed dimmed as "already empty".
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('navaid.routes');
      localStorage.removeItem('navaid.pageSize');
      localStorage.removeItem('navaid.vorRef');
      localStorage.removeItem('navaid.vorRef2');
    } catch (e) { /* storage unavailable */ }
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof setReferenceVor2 === 'function' && typeof draw === 'function'
    && typeof loadVors === 'function' && !!document.getElementById('clear'));
  await page.evaluate(() => loadVors());
  await page.evaluate(() => {
    for (const cb of document.querySelectorAll('.tb-section[data-sec="weather"] input[type="checkbox"]:checked')) {
      cb.checked = false;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

const refs = (page) => page.evaluate(() => ({
  v1: window.vorRef || null,
  v2: window.vorRef2 || null,
  s1: localStorage.getItem('navaid.vorRef'),
  s2: localStorage.getItem('navaid.vorRef2'),
  pick1: (document.getElementById('vor-ref-select') || { value: '' }).value,
  pick2: (document.getElementById('vor-ref-select-2') || { value: '' }).value,
}));
const dimmed = (page) => page.evaluate(() => document.getElementById('clear').classList.contains('is-dim'));

test('Clear map removes VOR 1 and VOR 2, and a reference alone keeps the button live', async ({ page }) => {
  await boot(page);
  expect(await dimmed(page), 'nothing on the map yet').toBe(true);
  const [a, b] = ['NAT', 'BGN'];
  await page.evaluate(([x, y]) => { setReferenceVor(x); setReferenceVor2(y); draw(); }, [a, b]);
  expect(await refs(page)).toMatchObject({ v1: a, v2: b, s1: a, s2: b });
  expect(await dimmed(page), 'a reference VOR is something to clear').toBe(false);

  await page.evaluate(() => document.getElementById('clear').click());
  expect(await refs(page)).toEqual({ v1: null, v2: null, s1: null, s2: null, pick1: '', pick2: '' });
  expect(await dimmed(page)).toBe(true);
});
