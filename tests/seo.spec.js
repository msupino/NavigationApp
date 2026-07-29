// @ts-check
// Verifies SEO-critical URLs — canonical, Open Graph, JSON-LD,
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

async function structuredData(page) {
  const text = await page.locator('script[type="application/ld+json"]').textContent();
  const data = JSON.parse(text || '{}');
  return Array.isArray(data['@graph']) ? data['@graph'] : [data];
}

function hasType(node, type) {
  const value = node && node['@type'];
  return Array.isArray(value) ? value.includes(type) : value === type;
}

function structuredNode(nodes, type) {
  const node = nodes.find(item => hasType(item, type));
  expect(node, `${type} JSON-LD node`).toBeTruthy();
  return node;
}

test.describe('SEO URLs', () => {

  test('indexable metadata includes CVFR Israel map navigation aid phrase', async ({ page }) => {
    // Pin English: the default UI language is now Hebrew (which localizes the
    // <title>); this asserts the English indexable variant.
    await page.goto('?lang=en');
    const target = /CVFR Israel Map Navigation Aid/i;
    await expect(page).toHaveTitle(target);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', target);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', target);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', target);
    await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute('content', target);
    await expect(page.locator('meta[name="twitter:description"]')).toHaveAttribute('content', target);
    await expect(page.locator('header.sr-only h1')).toContainText(target);

    const nodes = await structuredData(page);
    const app = structuredNode(nodes, 'WebApplication');
    const haystack = [
      app.name,
      ...(Array.isArray(app.alternateName) ? app.alternateName : []),
      app.description,
      ...(Array.isArray(app.keywords) ? app.keywords : []),
    ].join(' ');
    expect(haystack).toMatch(target);
  });

  test('site name metadata prefers NavAid over the domain', async ({ page }) => {
    await page.goto('.');
    await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute('content', 'NavAid');

    const nodes = await structuredData(page);
    const site = structuredNode(nodes, 'WebSite');
    expect(site.name).toBe('NavAid');
    expect(site.name).not.toMatch(/^supino\.org$/i);
    expect(site.url).toBe(CUSTOM_DOMAIN + '/');
    expect(site.alternateName).toContain('CVFR Israel Map Navigation Aid');
  });

  test('favicon metadata exposes a crawlable square PNG icon', async ({ page }) => {
    await page.goto('.');
    const icon = page.locator('link[rel="icon"][type="image/png"]');
    await expect(icon).toHaveAttribute('href', 'assets/icon-192.png');
    await expect(icon).toHaveAttribute('sizes', '192x192');

    const resp = await page.request.get('assets/icon-192.png');
    expect(resp.ok()).toBe(true);
    expect(resp.headers()['content-type']).toContain('image/png');
  });

  test('canonical uses the custom domain, with no hreflang alternates', async ({ page }) => {
    await page.goto('.');
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveAttribute('href', CUSTOM_DOMAIN + '/');
    // The ?lang= alternates are gone on purpose. They are not separate documents — the
    // same HTML is served either way, language applied client-side — so they could not be
    // self-canonical as hreflang requires, and Search Console reported every one as
    // "Alternate page with proper canonical tag".
    await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(0);
  });

  test('Open Graph tags use custom domain', async ({ page }) => {
    await page.goto('.');
    const ogUrl = page.locator('meta[property="og:url"]');
    await expect(ogUrl).toHaveAttribute('content', CUSTOM_DOMAIN + '/');

    const ogImage = page.locator('meta[property="og:image"]');
    await expect(ogImage).toHaveAttribute('content', CUSTOM_DOMAIN + '/assets/og-preview.jpg');
  });

  test('Twitter Card tags use custom domain', async ({ page }) => {
    await page.goto('.');
    const twImage = page.locator('meta[name="twitter:image"]');
    await expect(twImage).toHaveAttribute('content', CUSTOM_DOMAIN + '/assets/og-preview.jpg');
    const twTitle = page.locator('meta[name="twitter:title"]');
    await expect(twTitle).toHaveAttribute('content', /.+/);
    const twDesc = page.locator('meta[name="twitter:description"]');
    await expect(twDesc).toHaveAttribute('content', /.+/);
  });

  test('JSON-LD structured data uses custom domain', async ({ page }) => {
    await page.goto('.');
    const nodes = await structuredData(page);
    const site = structuredNode(nodes, 'WebSite');
    const app = structuredNode(nodes, 'WebApplication');
    expect(site.url).toBe(CUSTOM_DOMAIN + '/');
    expect(app.url).toBe(CUSTOM_DOMAIN + '/');
    expect(app.image).toBe(CUSTOM_DOMAIN + '/assets/og-preview.jpg');
    expect(Array.isArray(app.keywords)).toBe(true);
    expect(app.keywords.length).toBeGreaterThan(0);
    expect(Array.isArray(app.featureList)).toBe(true);
    expect(app.featureList.length).toBeGreaterThan(0);
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
    // No hreflang alternates and no ?lang= URLs: those are not separate pages (see the
    // canonical test above). What IS listed is the app plus the three legal/about pages,
    // each of which declares itself canonical.
    expect(text).not.toContain('hreflang=');
    expect(text).not.toContain('?lang=');
    expect(locs.length).toBe(4);
  });

  test('no msupino.github.io URLs in SEO tags', async ({ page }) => {
    await page.goto('.');
    // Check that no SEO-critical tags reference the old domain.
    const tags = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll(
        'link[rel="canonical"], link[hreflang], ' +
        'meta[property="og:url"], meta[property="og:image"], ' +
        'meta[name="twitter:image"], ' +
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
