// @ts-check
// The NOTAM list title in Hebrew is an RTL line; its "<total> · <new> new" tail is two numbers
// round a middot. Left to bidi they swap (56 · 2 read as 2 · 56 — reported). The count tail is
// isolated LTR (U+2066…U+2069) so the numbers keep their order, the scope first-strong isolated.
const { test, expect } = require('./_setup');
const NOTAM_RE = /notam-data\/notam\.json/;
const DATA = {
  generatedAt: new Date().toISOString(),
  notams: [
    { id: 'C1/26', icao: 'LLLL', end: '2035-01-01T00:00:00Z', geom: null, text: 'C1 one.' },
    { id: 'C2/26', icao: 'LLLL', end: '2035-01-01T00:00:00Z', geom: null, text: 'C2 two.' },
    { id: 'C3/26', icao: 'LLLL', end: '2035-01-01T00:00:00Z', geom: null, text: 'C3 three.' },
  ],
};

async function open(page, lang) {
  await page.route(NOTAM_RE, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DATA) }));
  // Seen one id already, so it is NOT first run: the other two count as new.
  await page.addInitScript(() => { try {
    localStorage.setItem('navaid.sec.weather', '1'); localStorage.setItem('navaid.sec.charts', '1');
    localStorage.setItem('navaid.notamSeen', JSON.stringify({ 'C1/26': Date.now() }));
  } catch (e) {} });
  await page.goto('?lang=' + lang + '&nogist');
  await page.waitForFunction(() => typeof draw === 'function' && document.getElementById('notam-cb'));
  await page.locator('#notam-cb').check();
  await page.waitForFunction(() => Array.isArray(notams) && notams.length === 3);
  await page.evaluate(() => document.getElementById('notam-list-btn').click());
  return (await page.locator('.notam-modal h3').textContent()) || '';
}

const LRI = '⁦', FSI = '⁨', PDI = '⁩';

test('each number is first-strong isolated so the Hebrew count keeps its order', async ({ page }) => {
  const t = await open(page, 'he');
  expect(t).toContain(FSI + '3' + PDI);                 // total, isolated
  expect(t).toContain(FSI + '2' + PDI);                 // new count, isolated
  expect(t).toContain('חדשים');                          // the Hebrew "new" flows with the line
  expect(new RegExp(FSI + 'LLLL[^' + PDI + ']*' + PDI).test(t)).toBe(true);   // scope first-strong isolated
  // Logical order is total then new; the per-number isolates keep each LTR under RTL.
  expect(t.replace(new RegExp('[' + LRI + FSI + PDI + ']', 'g'), '')).toContain('3 · 2 חדשים');
});

test('English title is unchanged in substance', async ({ page }) => {
  const t = await open(page, 'en');
  const bare = t.replace(new RegExp('[' + LRI + FSI + PDI + ']', 'g'), '');
  expect(bare).toBe('Active NOTAMs (LLLL — Global (FIR)) — 3 · 2 new');
});
