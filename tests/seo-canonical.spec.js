// @ts-check
// Search Console reported "Alternate page with proper canonical tag" for pages that were
// never separate pages: ?lang=he / ?lang=en were advertised as hreflang alternates while
// the canonical collapsed them to "/", and the preview deployments (which serve the same
// HTML, canonical included) were crawlable.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const read = f => fs.readFileSync(path.join('docs', f), 'utf8');

test('the app page is self-canonical with no hreflang alternates', async ({ page }) => {
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof draw === 'function');
  const r = await page.evaluate(() => ({
    canonical: document.querySelector('link[rel="canonical"]').href,
    alternates: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map(l => l.href),
  }));
  expect(r.canonical).toBe('https://navaid.supino.org/');
  expect(r.alternates).toEqual([]);            // the source of the report
});

test('switching language still works without the alternates', async ({ page }) => {
  // The tags were metadata only — the in-app switcher and its persistence must be intact.
  await page.goto('?lang=he&nogist');
  await page.waitForFunction(() => typeof draw === 'function');
  const he = await page.evaluate(() => ({ dir: document.documentElement.dir,
    lang: document.documentElement.lang, sample: S.tbPrint }));
  expect(he.dir).toBe('rtl');
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof draw === 'function');
  const en = await page.evaluate(() => ({ dir: document.documentElement.dir,
    lang: document.documentElement.lang, sample: S.tbPrint }));
  expect(en.dir).not.toBe('rtl');
  expect(en.sample).not.toBe(he.sample);
});

test('robots.txt keeps crawlers out of non-production and reserved paths', () => {
  const robots = read('robots.txt');
  for (const p of ['/staging/', '/pr/', '/branch/']) {
    expect(robots, p).toContain('Disallow: ' + p);
  }
  expect(robots).toContain('Allow: /');                    // production still crawlable
  expect(robots).toContain('Sitemap: https://navaid.supino.org/sitemap.xml');
});

test('the sitemap lists only self-canonical pages, with no alternates', () => {
  const xml = read('sitemap.xml');
  expect(xml).not.toContain('hreflang=');                  // no advertised non-pages
  expect(xml).not.toContain('?lang=');
  expect(xml).not.toContain('<xhtml:link');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  expect(locs).toEqual([
    'https://navaid.supino.org/',
    'https://navaid.supino.org/about.html',
    'https://navaid.supino.org/privacy.html',
    'https://navaid.supino.org/terms.html',
  ]);
  // every listed page declares itself canonical, which is what hreflang required and
  // ?lang= could never satisfy
  for (const f of ['about.html', 'privacy.html', 'terms.html']) {
    expect(read(f)).toContain(`<link rel="canonical" href="https://navaid.supino.org/${f}">`);
  }
  expect(read('index.html')).toContain('<link rel="canonical" href="https://navaid.supino.org/">');
});
