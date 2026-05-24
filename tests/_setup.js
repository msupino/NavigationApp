// @ts-check
// Shared Playwright test fixture: re-export `test`/`expect` with every page
// pre-wired to block Google Analytics + Google Tag Manager so test runs never
// pollute the production GA4 property (G-0XM5PHEK8B) — neither in CI nor on
// developer laptops. Spec files import from here instead of @playwright/test.
//
//   const { test, expect } = require('./_setup');
const base = require('@playwright/test');

const GA_HOSTS = [
  'www.googletagmanager.com',
  'www.google-analytics.com',
  'analytics.google.com',
  'region1.google-analytics.com',
  'region1.analytics.google.com',
  'stats.g.doubleclick.net',
];

exports.test = base.test.extend({
  page: async ({ page }, use) => {
    // 1. Network-level: every Google Analytics / GTM request aborts before it
    //    leaves the test harness. Catches both the gtag/js loader and the
    //    /g/collect beacons that the in-page script would have fired.
    await page.route('**/*', route => {
      const url = route.request().url();
      try {
        const host = new URL(url).hostname;
        if (GA_HOSTS.includes(host) ||
            host.endsWith('.googletagmanager.com') ||
            host.endsWith('.google-analytics.com')) {
          return route.abort();
        }
      } catch (e) { /* relative URLs etc. */ }
      return route.continue();
    });

    // 2. Page-level: stub gtag() and dataLayer.push() before any app script
    //    runs, so calls queued before the network blocks engage are no-ops.
    //    Belt and braces against future changes to how GA is wired up.
    await page.addInitScript(() => {
      try {
        window.dataLayer = { push: () => {} };
        window.gtag = function () { /* no-op for tests */ };
      } catch (e) {}
    });

    await use(page);
  },
});

exports.expect = base.expect;
