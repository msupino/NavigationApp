// @ts-check
// Guard the browser trust boundary: production has no mutable analytics
// runtime, and every pinned third-party runtime asset authenticates its bytes.
const { test, expect } = require('./_setup');

const GA_RE = /(googletagmanager|google-analytics|analytics\.google|doubleclick)\.(com|net)/;
// The property the live site feeds. Pinned here so removing or blanking it fails the build:
// it was lost once in a commit that never mentioned analytics, and nothing noticed for weeks.
const GA4_ID = 'G-0XM5PHEK8B';

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
  // The tag is SUPPOSED to be here. It was removed on 4 Aug 2026 inside a hardening commit
  // whose message never mentions analytics, and the GA4 property recorded nothing for six
  // weeks before anyone noticed it was empty. This test used to assert the opposite -- that
  // the tag was absent -- which would have made putting it back fail the build.
  test('production HTML carries the GA4 tag, gated to production', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
    // The exact property, not just "some GA tag": a blanked or mistyped id is a tag that
    // loads, reports success, and feeds nothing -- indistinguishable from what happened here.
    expect(html, 'the GA4 tag must not be removed; see the comment beside it in index.html')
      .toContain('googletagmanager.com/gtag/js?id=' + GA4_ID);
    expect(html).toContain("gtag('config', '" + GA4_ID + "')");
    // ...and every gate it is supposed to be behind. A tag that fired from a PR preview, a
    // branch build or the native shell would mix three different things into one property.
    expect(html, 'the staging / pr / branch exclusion').toMatch(/staging\|pr\|branch/);
    expect(html, 'the native-shell exclusion').toMatch(/typeof window\.Capacitor === 'undefined'/);
    expect(html, 'the local-dev exclusion').toMatch(/location\.hostname !== 'app\.navaid\.local'/);
  });

  // The gate is a regex in a one-line script, which is exactly the kind of thing that rots
  // silently: it is never exercised in CI (the tests run at the origin root) and a mistake in
  // it mixes PR previews and branch builds into the production property. Pull it out of the
  // page and run it against the paths it is meant to divide.
  test('the path gate keeps previews out of the property', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
    const m = html.match(/location\.pathname\.match\((\/.+?\/)\)/);
    expect(m, 'the path exclusion regex is still in the page').not.toBeNull();
    const re = eval(m[1]);
    const blocked = (p) => !!p.match(re);
    // Served from the apex and from the GitHub Pages repo prefix: production either way.
    expect(blocked('/')).toBe(false);
    expect(blocked('/index.html')).toBe(false);
    expect(blocked('/NavigationApp/')).toBe(false);
    // ...and everything that is not production.
    expect(blocked('/staging/')).toBe(true);
    expect(blocked('/pr/2341/')).toBe(true);
    expect(blocked('/branch/restore-ga/')).toBe(true);
    expect(blocked('/NavigationApp/pr/2341/')).toBe(true);
    expect(blocked('/NavigationApp/staging/index.html')).toBe(true);
  });

  // What the page promises has to match what it loads. Both languages.
  test('the privacy page discloses it', () => {
    const fs = require('fs');
    const path = require('path');
    const privacy = fs.readFileSync(path.join(__dirname, '..', 'docs', 'privacy.html'), 'utf8');
    expect(privacy).toMatch(/Google Analytics/);
    expect(privacy).toMatch(/אנליטיקס|Google Analytics/);
    // The claim this replaced. Leaving it in place beside the tag would be a false statement.
    expect(privacy, 'the old "no analytics" claim must be gone')
      .not.toMatch(/no backend and no analytics/);
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
