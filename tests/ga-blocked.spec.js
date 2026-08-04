// @ts-check
// Guard the browser trust boundary: production has no mutable analytics
// runtime, and every pinned third-party runtime asset authenticates its bytes.
const { test, expect } = require('./_setup');

const GA_RE = /(googletagmanager|google-analytics|analytics\.google|doubleclick)\.(com|net)/;

// Static guard: every spec must import test/expect from ./_setup, not straight
// from @playwright/test. The GA-blocking route lives in the _setup `page`
// fixture, so a spec importing @playwright/test directly runs UNPROTECTED and
// fires real GA hits against the local server root (index.html loads GA there).
test.describe('GA-block coverage', () => {
  test('no spec imports @playwright/test directly', () => {
    const fs = require('fs');
    const path = require('path');
    const offenders = fs.readdirSync(__dirname)
      .filter(f => f.endsWith('.spec.js'))
      .filter(f => /require\((['"])@playwright\/test\1\)/.test(
        fs.readFileSync(path.join(__dirname, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});

test.describe('third-party runtime integrity', () => {
  test('production HTML contains no Google Analytics / GTM runtime', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
    expect(html).not.toMatch(/googletagmanager|google-analytics|\bgtag\s*\(/);
  });

  test('no GA / GTM request completes successfully', async ({ page }) => {
    const completed = [];
    page.on('requestfinished', req => {
      if (GA_RE.test(req.url())) completed.push(req.url());
    });
    await page.goto('?lang=en');
    await page.waitForFunction(() => typeof state !== 'undefined');
    await page.waitForTimeout(400);              // give any beacon time to fire
    expect(completed).toEqual([]);
  });

  test('every CDN stylesheet and script carries SHA-384 SRI', async ({ page }) => {
    await page.goto('?lang=en');
    const assets = await page.evaluate(() => [...document.querySelectorAll(
      'script[src^="https://unpkg.com"],script[src^="https://cdn.jsdelivr.net"],'
      + 'link[href^="https://unpkg.com"],link[href^="https://cdn.jsdelivr.net"]')]
      .map(el => ({ url: el.src || el.href, integrity: el.integrity,
        crossOrigin: el.crossOrigin })));
    expect(assets.length).toBe(6);
    for (const asset of assets) {
      expect(asset.integrity, asset.url).toMatch(/^sha384-[A-Za-z0-9+/=]+$/);
      expect(asset.crossOrigin, asset.url).toBe('anonymous');
    }
  });
});
