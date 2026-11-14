// @ts-check
// Asked: "on app, use IAA directly; on browser use the GitHub Action which updates from the site".
// The apps POST to IAA's AeroInfo NOTAM API through Capacitor's native HTTP and parse it with
// app/notam-iaa.js -- the same file the hourly Action requires -- and fall back to notam.json on
// any failure. A browser never asks IAA (no CORS there); it reads notam.json as before.
const { test, expect } = require('./_setup');
const path = require('path');
const IAA = require('../docs/app/notam-iaa.js');
const FIXTURE = require('./fixtures/iaa-notams.json');   // 14 real IAA records, 14 Nov 2026

test('the shared parser turns IAA records into notam.json records, IFR-only dropped', () => {
  const r = IAA.parseIaaNotams(FIXTURE);
  expect(r.detailTotal).toBe(FIXTURE.length);
  expect(r.detailOk).toBe(FIXTURE.length);
  expect(r.notams.length + r.skipped).toBe(FIXTURE.length);
  for (const n of r.notams) {
    expect(n.id).toMatch(/^[A-Z]\d{4}\/\d{2}$/);
    expect(n.icao).toMatch(/^LL[A-Z]{2}$/);
    expect(n.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/);
    expect(n.text.length).toBeGreaterThan(0);
  }
  // A degraded answer is refused, so a caller keeps its last good set.
  expect(() => IAA.parseIaaNotams(FIXTURE.slice(0, 3))).toThrow(/only 3 NOTAMs/);
  expect(() => IAA.parseIaaNotams({ error: 'blocked' })).toThrow(/array/);
});

test('the Update NOTAMs Action requires the same parser file', () => {
  const yml = require('fs').readFileSync(path.join(__dirname, '../.github/workflows/notam.yml'), 'utf8');
  expect(yml).toContain("('./docs/app/notam-iaa.js')");
  expect(yml).toContain('sparse-checkout: docs/app/notam-iaa.js');
  expect(yml).not.toMatch(/const geomFromRaw =/);         // no second copy to drift
});

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof loadNotam === 'function' && !!window.NavAidNotamIaa);
}

test('in the app, NOTAMs come straight from IAA by native HTTP', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async (fixture) => {
    const calls = [];
    window.Capacitor = { isNativePlatform: () => true, Plugins: { CapacitorHttp: {
      request: async (o) => { calls.push(o); return { status: 200, data: fixture }; } } } };
    await loadNotam(true);
    return { calls, meta: notamMeta, ids: notams.map(n => n.id) };
  }, FIXTURE);
  expect(got.calls).toHaveLength(1);
  expect(got.calls[0].url).toBe('https://aeroinfo.iaa.gov.il/api/api/AeroInfo/GetNotams');
  expect(got.calls[0].method).toBe('POST');
  expect(got.calls[0].data).toMatchObject({ regions: 'North,Center,South', series: '3', nonActive: false });
  expect(got.meta.source).toBe('IAA (direct)');
  expect(Date.now() - Date.parse(got.meta.generatedAt)).toBeLessThan(60000);
  expect(got.ids).toEqual(IAA.parseIaaNotams(FIXTURE).notams.map(n => n.id));
});

for (const [name, answer] of [
  ['an HTTP error', { status: 403, data: 'Forbidden' }],
  ['a block page', { status: 200, data: '<html>challenge</html>' }],
  ['a thin list', { status: 200, data: 'THIN' }],
]) test(`in the app, ${name} from IAA falls back to notam.json`, async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async ({ answer, fixture }) => {
    if (answer.data === 'THIN') answer.data = fixture.slice(0, 2);
    window.Capacitor = { isNativePlatform: () => true, Plugins: { CapacitorHttp: {
      request: async () => answer } } };
    await loadNotam(true);
    return { meta: notamMeta, isArray: Array.isArray(notams) };
  }, { answer, fixture: FIXTURE });
  expect(got.isArray).toBe(true);
  expect(got.meta.source).not.toBe('IAA (direct)');
});

test('in a browser, IAA is never asked: notam.json as before', async ({ page }) => {
  await boot(page);
  const got = await page.evaluate(async () => {
    let asked = false;
    // A non-native Capacitor shell (the web build) must not use it either.
    window.Capacitor = { isNativePlatform: () => false, Plugins: { CapacitorHttp: {
      request: async () => { asked = true; return { status: 200, data: [] }; } } } };
    await loadNotam(true);
    return { asked, usable: NavAidNotamIaa.usable(), source: notamMeta && notamMeta.source };
  });
  expect(got.asked).toBe(false);
  expect(got.usable).toBe(false);
  expect(got.source).not.toBe('IAA (direct)');
});
