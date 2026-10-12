// @ts-check
// Latin numbers inside Hebrew text: left to the bidi algorithm, "Herzliya 3.2 NM 358°M" in
// an RTL row read "NM 358°M 3.2" (reported on the phone), and "40 NM" alone in an RTL cell
// read "NM 40". Each case is measured where it is drawn: the glyphs must sit left to right.
const { test, expect } = require('./_setup');

// x of the first character of `a` and of `b` inside an element's text.
const order = (page, sel, a, b) => page.evaluate(([sel, a, b]) => {
  const el = typeof sel === 'string' ? document.querySelector(sel) : null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const x = (needle) => {
    walker.currentNode = el;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.nodeValue.indexOf(needle);
      if (i < 0) continue;
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
      return r.getBoundingClientRect().left;
    }
    return null;
  };
  return { a: x(a), b: x(b), text: el.textContent };
}, [sel, a, b]);

const leftOf = (got) => {
  expect(got.a, got.text).not.toBeNull();
  expect(got.b, got.text).not.toBeNull();
  expect(got.a, got.text).toBeLessThan(got.b);
};

test.beforeEach(async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof showInspector === 'function' && Array.isArray(window.airfields) && airfields.length && window.vors && vors.length);
});

test('nearest field: the distance reads "3.2 NM", the bearing "358°M"', async ({ page }) => {
  await page.evaluate(() => { state.selected = { type: 'coord', lat: 32.1267, lng: 34.83, held: true }; showInspector(); });
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('#insp-body .row')].find(r => r.querySelector('label').textContent === S.deckHereNearest);
    row.querySelector('.val').id = 'nf-val';
  });
  leftOf(await order(page, '#nf-val', '.', 'NM'));   // "3.2 NM", not "NM 3.2"
  leftOf(await order(page, '#nf-val', 'NM', '°'));   // distance, then bearing
  leftOf(await order(page, '#nf-val', 'NM', 'הרצליה')); // the name on the right, where Hebrew starts
});

test('VOR range and antenna elevation read "40 NM" and "100 ft"', async ({ page }) => {
  await page.evaluate(() => { state.selected = { type: 'vor', index: vors.findIndex(v => v.ident === 'NAT') }; showInspector(); });
  const vals = await page.evaluate(() => [...document.querySelectorAll('.vor-aip-val')]
    .filter(v => /^\d+ (NM|ft)$/.test(v.textContent)).map((v, i) => [(v.id = 'aip-' + i), v.textContent.split(' ')[1]]));
  expect(vals.length).toBe(2);
  for (const [id, unit] of vals) leftOf(await order(page, '#' + id, '0', unit));
});

test('strings drawn in an RTL line keep their Latin runs in order', async ({ page }) => {
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'bidi-host'; host.dir = 'rtl'; host.style.cssText = 'position:fixed;top:0;right:0;font:16px sans-serif;background:#fff';
    for (const [id, t] of [
      ['wind', S.windEffectText('214', 96, '+4', '0:05:12')],
      ['goto', S.gotoError],
      ['area', S.offlineAreaLevel(12, 3400, '45 MB')],
    ]) { const d = document.createElement('div'); d.id = id; d.textContent = t; host.appendChild(d); }
    document.body.appendChild(host);
  });
  // Read right to left: heading, then GS, then WCA, then the time.
  leftOf(await order(page, '#wind', 'WCA', 'GS'));
  leftOf(await order(page, '#wind', 'GS', '96'));
  leftOf(await order(page, '#goto', '32°', '34°'));
  leftOf(await order(page, '#goto', '17', 'N'));
  leftOf(await order(page, '#area', '45', 'MB'));
});
