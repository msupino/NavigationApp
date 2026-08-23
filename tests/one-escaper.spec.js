// @ts-check
// Every file NavAid writes — GPX, KML, PLN, the printable plan, the editor's panels — used
// its own escaper. Six copies, four character sets: some escaped quotes, some did not. The
// ones that did not were a line's edit from a waypoint name with a quote in it breaking out
// of an attribute, and a name with an ampersand already produced XML no parser would accept.
const { test, expect } = require('./_setup');

async function boot(page) {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof escapeXml === 'function' &&
    typeof exportGpx === 'function' && typeof gpsTrackToGpx === 'function');
  // The exporters write a file rather than returning one: catch what they hand the browser.
  await page.evaluate(() => {
    window.__written = [];
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      blob.text().then(t => window.__written.push(t));
      return realCreate.call(URL, blob);
    };
    HTMLAnchorElement.prototype.click = function () { /* no navigation in a test */ };
  });
}

const NASTY = 'A&B <tag> "quoted" \'single\'';

test('the escaper covers the whole set, including both quotes', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate((s) => escapeXml(s), NASTY))
    .toBe('A&amp;B &lt;tag&gt; &quot;quoted&quot; &#39;single&#39;');
});

test('it says nothing about null and undefined rather than printing them', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => [escapeXml(null), escapeXml(undefined), escapeXml(0)]))
    .toEqual(['', '', '0']);
});

// The exports themselves: a name that would break the file must not appear raw in one.
test('a hostile waypoint name survives every export as text, not markup', async ({ page }) => {
  await boot(page);
  const out = await page.evaluate(async (name) => {
    state.waypoints = [
      { lat: 32.1, lng: 34.8, name },
      { lat: 32.4, lng: 35.0, name: 'PLAIN' },
    ];
    syncLegs();
    window.__written = [];
    exportGpx();
    exportPln();
    await new Promise(r => setTimeout(r, 200));
    const track = gpsTrackToGpx({ name, track: [{ lat: 32, lng: 34, t: 1 }, { lat: 32.1, lng: 34.1, t: 2 }] });
    return { gpx: window.__written[0] || '', pln: window.__written[1] || '', track };
  }, NASTY);
  // Every format: nothing raw, nothing that reads as markup.
  for (const [kind, text] of Object.entries(out)) {
    expect(text.length, kind).toBeGreaterThan(0);
    expect(text, kind).not.toContain('<tag>');
    expect(text.includes(NASTY), kind).toBe(false);
  }
  // The formats that carry the name verbatim carry it escaped. PLN is not one of them: it
  // sanitises waypoint ids down to letters and digits, so the name never reaches the file.
  for (const kind of ['gpx', 'track']) {
    expect(out[kind], kind).toContain('&lt;tag&gt;');
    expect(out[kind], kind).toContain('&amp;');
    expect(out[kind], kind).toContain('&quot;');
  }
});

// XML that a parser will actually accept, rather than one that merely looks escaped.
test('the exports parse', async ({ page }) => {
  await boot(page);
  const ok = await page.evaluate(async (name) => {
    state.waypoints = [{ lat: 32.1, lng: 34.8, name }, { lat: 32.4, lng: 35.0, name: 'B' }];
    syncLegs();
    window.__written = [];
    exportGpx();
    exportPln();
    await new Promise(r => setTimeout(r, 200));
    const parse = (s) => {
      const doc = new DOMParser().parseFromString(s || '<empty/>', 'application/xml');
      return !doc.querySelector('parsererror');
    };
    return { gpx: parse(window.__written[0]), pln: parse(window.__written[1]),
             track: parse(gpsTrackToGpx({ name, track: [{ lat: 32, lng: 34, t: 1 }] })) };
  }, NASTY);
  expect(ok).toEqual({ gpx: true, pln: true, track: true });
});
