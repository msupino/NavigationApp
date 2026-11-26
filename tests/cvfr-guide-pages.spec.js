// @ts-check
// The CVFR flight-planning guide: a crawlable page in English and its Hebrew twin, each at its
// own URL. Unlike the app (one document whose ?lang= is applied in the browser), these are two
// real documents, so they may name each other as hreflang alternates -- each is its own
// canonical and points back. Guarded here: the pair stays reciprocal, the language is in the
// HTML (not set by a script), the official sources are linked, and the pages are reachable
// from About, the app's header and the sitemap.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('./_setup');

const ORIGIN = 'https://navaid.supino.org/';
// The address a page is known by: no .html (Cloudflare Pages 308s *.html to the bare path).
const url = (file) => ORIGIN + file.replace(/\.html$/, '');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'docs', f), 'utf8');
const GUIDES = [
  { file: 'cvfr-flight-planning-israel.html', lang: 'en', dir: 'ltr', other: 'he',
    h1: 'CVFR flight planning in Israel' },
  { file: 'cvfr-flight-planning-israel-he.html', lang: 'he', dir: 'rtl', other: 'en',
    h1: 'תכנון טיסת CVFR בישראל' },
];

for (const g of GUIDES) {
  test(`${g.file}: own language, self-canonical, reciprocal hreflang`, () => {
    const html = read(g.file);
    expect(html).toContain(`<html lang="${g.lang}" dir="${g.dir}">`);
    expect(html).toContain(`<link rel="canonical" href="${url(g.file)}">`);
    expect(html).toContain(`<link rel="alternate" hreflang="${g.lang}" href="${url(g.file)}">`);
    const twin = GUIDES.find((x) => x.lang === g.other);
    expect(html).toContain(`<link rel="alternate" hreflang="${g.other}" href="${url(twin.file)}">`);
    expect(read(twin.file)).toContain(`hreflang="${g.lang}" href="${url(g.file)}"`);
    // the official sources a pilot must check, and the planning-aid caveat
    expect(html).toContain('https://www.gov.il/en/departments/guides/aip-israel');
    expect(html).toContain('https://www.iaa.gov.il/en/about/aeronautical-information/');
    // no script decides the language or hides content from a crawler
    expect(html).not.toMatch(/<script/i);
  });

  test(`${g.file} renders its heading and links into the app`, async ({ page }) => {
    await page.goto(g.file);
    await expect(page.locator('h1')).toHaveText(g.h1);
    await expect(page.locator('a.cta')).toHaveAttribute('href', g.lang === 'en' ? './?lang=en' : './');
    const box = await page.locator('a.cta').boundingBox();
    expect(box && box.height).toBeGreaterThanOrEqual(44);
    // no horizontal scroll on a phone
    await page.setViewportSize({ width: 390, height: 844 });
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(wide).toBe(false);
  });
}

test('the guide is linked from About, the app header and the sitemap', () => {
  const about = read('about.html');
  expect(about).toContain('href="cvfr-flight-planning-israel.html"');
  expect(about).toContain('href="cvfr-flight-planning-israel-he.html"');
  const header = read('index.html').match(/<header class="sr-only">[\s\S]*?<\/header>/)[0];
  expect(header).toContain('href="cvfr-flight-planning-israel.html"');
  expect(header).toContain('href="cvfr-flight-planning-israel-he.html"');
  const xml = read('sitemap.xml');
  for (const g of GUIDES) expect(xml).toContain(`<loc>${url(g.file)}</loc>`);
});
