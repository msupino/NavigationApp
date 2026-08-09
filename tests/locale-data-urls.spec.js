// @ts-check
// Dataset URLs must live ONLY in core.js. Locale files load BEFORE core.js, so any
// *Url they define wins the `||` fallback there — which meant every `?v=` bump was
// invisible to that locale and its users kept serving a cached dataset. Hebrew sat on
// airfields ?v=3 while core.js had reached ?v=33, and nav-waypoints ?v=3 vs ?v=9.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

const LOCALE_DIR = path.join(__dirname, '..', 'docs', 'i18n');

test('no locale file overrides a dataset URL', () => {
  const offenders = [];
  for (const lang of fs.readdirSync(LOCALE_DIR)) {
    const f = path.join(LOCALE_DIR, lang, 'strings.js');
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/^\s*([A-Za-z]+Url)\s*:\s*'([^']*)'/gm)) {
      offenders.push(`${lang}/strings.js: ${m[1]} = '${m[2]}'`);
    }
  }
  expect(offenders, 'dataset URLs belong in core.js only').toEqual([]);
});

test('both locales resolve the same dataset URLs at runtime', async ({ page }) => {
  const read = async lang => {
    await page.goto(`?lang=${lang}`);
    await page.waitForFunction(() => typeof S !== 'undefined' && !!S.vorUrl);
    return page.evaluate(() => ({
      routeGraph: S.routeGraphUrl, airfields: S.airfieldsUrl,
      routeTemplates: S.routeTemplatesUrl, vor: S.vorUrl,
    }));
  };
  const en = await read('en');
  const he = await read('he');
  expect(he).toEqual(en);          // identical, version suffix included
  // Locale FIELD choices must still differ — that is what the locale file is for.
  await page.goto('?lang=he');
  await page.waitForFunction(() => typeof S !== 'undefined' && !!S.navWpSearchField);
  expect(await page.evaluate(() => S.navWpSearchField)).toBe('he');
});
