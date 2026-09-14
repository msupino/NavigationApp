// @ts-check
// Privacy Policy + Terms of Service are standalone static pages that localize
// themselves the same way index.html does: ?lang wins, then the stored
// navaid.lang (shared per-origin with the app), else HEBREW. Hebrew renders
// RTL. These checks guard the language resolver and the per-language blocks.
//
// They used to fall back to English and then WRITE that fallback into navaid.lang, which the
// planner reads: a first-time visitor who opened Terms before the app had the app's language
// chosen for them by a page they were only reading. A page persists a CHOICE -- the ?lang the
// switch links carry -- never its own guess.
const { test, expect } = require('./_setup');

const PAGES = [
  { file: 'privacy.html', en: 'Privacy Policy', he: 'מדיניות פרטיות' },
  { file: 'terms.html', en: 'Terms of Service', he: 'תנאי שימוש' },
  // About heads both blocks with the product name; the visible block is what differs.
  { file: 'about.html', en: 'NavAid', he: 'NavAid' },
];

test.describe('Localized legal pages', () => {
  for (const p of PAGES) {
    test(`${p.file} renders Hebrew RTL with ?lang=he`, async ({ page }) => {
      await page.goto(p.file + '?lang=he');
      const html = page.locator('html');
      await expect(html).toHaveAttribute('lang', 'he');
      await expect(html).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('[data-lang="he"] h1')).toHaveText(new RegExp(p.he));
      // The English block is present in the DOM but hidden in Hebrew.
      await expect(page.locator('[data-lang="en"] h1')).toBeHidden();
      await expect(page.locator('[data-lang="he"] h1')).toBeVisible();
      expect(await page.title()).toContain(p.he);
    });

    test(`${p.file} renders English LTR with ?lang=en`, async ({ page }) => {
      await page.goto(p.file + '?lang=en');
      const html = page.locator('html');
      await expect(html).toHaveAttribute('lang', 'en');
      await expect(html).toHaveAttribute('dir', 'ltr');
      await expect(page.locator('[data-lang="en"] h1')).toHaveText(new RegExp(p.en));
      await expect(page.locator('[data-lang="he"] h1')).toBeHidden();
    });

    test(`${p.file} follows stored navaid.lang when no ?lang param`, async ({ page }) => {
      await page.addInitScript(() => {
        try { localStorage.setItem('navaid.lang', 'he'); } catch (e) {}
      });
      await page.goto(p.file);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('[data-lang="he"] h1')).toBeVisible();
    });

    test(`${p.file} language switch links to both locales`, async ({ page }) => {
      await page.goto(p.file + '?lang=en');
      await expect(page.locator('.lang-switch a[hreflang="he"]')).toHaveAttribute('href', '?lang=he');
      await expect(page.locator('.lang-switch a[hreflang="en"]')).toHaveAttribute('href', '?lang=en');
    });

    // The app's own default, so a first-time visitor reads the same language wherever they
    // land first.
    test(`${p.file} defaults to Hebrew, like the app`, async ({ page }) => {
      await page.goto(p.file);
      await expect(page.locator('html')).toHaveAttribute('lang', 'he');
      await expect(page.locator('[data-lang="he"] h1')).toBeVisible();
    });

    // The bug this pins: reading a page must not choose the planner's language.
    test(`${p.file} does not pin a language it only guessed`, async ({ page }) => {
      await page.goto(p.file);
      expect(await page.evaluate(() => localStorage.getItem('navaid.lang')),
        'a page the pilot only read wrote the app\'s language').toBeNull();
      // ...and a stored choice is still followed, and still not rewritten by the page.
      await page.evaluate(() => localStorage.setItem('navaid.lang', 'en'));
      await page.goto(p.file);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      expect(await page.evaluate(() => localStorage.getItem('navaid.lang'))).toBe('en');
    });

    // Pressing the switch IS a choice, and that one is kept -- it is what carries the
    // language back to the planner.
    test(`${p.file} remembers the language the reader asked for`, async ({ page }) => {
      await page.goto(p.file + '?lang=en');
      expect(await page.evaluate(() => localStorage.getItem('navaid.lang'))).toBe('en');
      await page.goto(p.file + '?lang=he');
      expect(await page.evaluate(() => localStorage.getItem('navaid.lang'))).toBe('he');
    });
  }
});
