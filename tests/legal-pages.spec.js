// @ts-check
// Privacy Policy + Terms of Service are standalone static pages that localize
// themselves the same way index.html does: ?lang wins, then the stored
// navaid.lang (shared per-origin with the app), else English. Hebrew renders
// RTL. These checks guard the language resolver and the per-language blocks.
const { test, expect } = require('./_setup');

const PAGES = [
  { file: 'privacy.html', en: 'Privacy Policy', he: 'מדיניות פרטיות' },
  { file: 'terms.html', en: 'Terms of Service', he: 'תנאי שימוש' },
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
  }
});
