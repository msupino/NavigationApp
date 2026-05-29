// @ts-check
// Verifies SEO-critical URLs — canonical, hreflang, Open Graph, JSON-LD,
// sitemap, and robots.txt — all point to navaid.supino.org (the custom
// domain), not msupino.github.io/NavigationApp/ (which 302-redirects).
//
// NOTE: all page navigations use relative paths `./` instead of `/` so
// the test resolves within the baseURL path (e.g. `/pr/424/` for e2e-deployed
// CI) rather than at the domain root. Using `/` in goto or request.get with
// a path-prefixed baseURL inadvertently loads the production site, which
// still has the old msupino.github.io URLs.
const { test, expect } = require('./_setup');

const CUSTOM_DOMAIN = 'https://navaid.supino.org';

test.describe('SEO URLs', () => {

  test('canonical and hreflang use custom domain', async ({ page }) => {
    await page.goto('.');
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveAttribute('href', CUSTOM_DOMAIN + '/');

    const hreflangHe = page.locator('link[hreflang="he"]');
    await expect(hreflangHe).toHaveAttribute('href', CUSTOM_DOMAIN + '/?lang=he');

    const hreflangEn = page.locator('link[hreflang="en"]');
    await expect(hreflangEn).toHaveAttribute('href', CUSTOM_DOMAIN + '/?lang=en');

    const hreflangDefault = page.locator('link[hreflang="x-default"]');
    await expect(hreflangDefault).toHaveAttribute('href', CUSTOM_DOMAIN + '/');
  });

  test('Open Graph tags use custom domain', async ({ page }) => {
    await page.goto('.');
    const ogUrl = page.locator('meta[property="og:url"]');
    await expect(ogUrl).toHaveAttribute('content', CUSTOM_DOMAIN + '/');

    const ogImage = page.locator('meta[property="og:image"]');
    await expect(ogImage).toHaveAttribute('content', CUSTOM_DOMAIN + '/og-preview.jpg');
  });

  test('JSON-LD structured data uses custom domain', async ({ page }) => {
    await page.goto('.');
    const jsonLd = page.locator('script[type="application/ld+json"]');
    const text = await jsonLd.textContent();
    const data = JSON.parse(text);
    expect(data.url).toBe(CUSTOM_DOMAIN + '/');
    expect(data.image).toBe(CUSTOM_DOMAIN + '/og-preview.jpg');
  });

  test('robots.txt points to correct sitemap URL', async ({ page }) => {
    const resp = await page.request.get('robots.txt');
    const text = await resp.text();
    expect(text).toContain('Sitemap: ' + CUSTOM_DOMAIN + '/sitemap.xml');
  });

  test('sitemap.xml URLs all use custom domain', async ({ page }) => {
    const resp = await page.request.get('sitemap.xml');
    const text = await resp.text();
    // Every <loc> and <xhtml:link href="..."> must reference custom domain.
    const locs = text.match(/<loc>[^<]+<\/loc>/g) || [];
    const hrefs = text.match(/href="[^"]+"/g) || [];
    for (const loc of locs) {
      expect(loc).toContain(CUSTOM_DOMAIN);
      expect(loc).not.toContain('msupino.github.io');
    }
    for (const href of hrefs) {
      expect(href).toContain(CUSTOM_DOMAIN);
      expect(href).not.toContain('msupino.github.io');
    }
    // Must have all 5 expected entries.
    expect(locs.length).toBe(5);
  });

  test('no msupino.github.io URLs in SEO tags', async ({ page }) => {
    await page.goto('.');
    // Check that no SEO-critical tags reference the old domain.
    const tags = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll(
        'link[rel="canonical"], link[hreflang], ' +
        'meta[property="og:url"], meta[property="og:image"], ' +
        'script[type="application/ld+json"]'
      ).forEach(el => {
        const attr = el.getAttribute('href') || el.getAttribute('content') || el.textContent || '';
        let referencesOldDomain = false;
        try {
          const parsed = new URL(attr, window.location.origin);
          referencesOldDomain = parsed.hostname === 'msupino.github.io';
        } catch {
          const urlLikeTokens = attr.match(/https?:\/\/[^\s"'<>]+|\/[^\s"'<>]*/g) || [];
          referencesOldDomain = urlLikeTokens.some(token => {
            try {
              const parsed = new URL(token, window.location.origin);
              return parsed.hostname === 'msupino.github.io';
            } catch {
              return false;
            }
          });
        }
        if (referencesOldDomain) results.push(el.outerHTML);
      });
      return results;
    });
    expect(tags).toEqual([]);
  });

});
