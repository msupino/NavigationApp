// @ts-check
// Shared Playwright test fixture: re-export `test`/`expect` with every page
// pre-wired to block Google Analytics + Google Tag Manager so test runs never
// pollute the production GA4 property (G-0XM5PHEK8B) — neither in CI nor on
// developer laptops. Spec files import from here instead of @playwright/test.
//
// Also verifies the deployed SHA when EXPECTED_SHA env var is set
// (e2e-deployed workflow), preventing tests from running against a stale
// or wrong deployment.
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

const EXPECTED_SHA = process.env.EXPECTED_SHA;

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
        // Block the remote tuning gist so tests boot with deterministic
        // baked-in defaults, never the live gist. Specs that exercise the
        // remote config register their own page.route for this URL, which
        // takes precedence (later registration wins).
        if (host === 'gist.githubusercontent.com') {
          return route.abort();
        }
        // Block the live NOTAM feed (notam-data branch on raw.githubusercontent)
        // so UI tests never pull the real ~90 active NOTAMs — that made the
        // NOTAM list button appear and intercept map clicks (e.g. magnifier).
        // CI runners can't reach it (so it silently fell back), but local runs
        // and e2e-deployed can. The app falls back to the empty same-origin
        // data/notam.json. Specs that need NOTAMs (notam-layer) register their
        // own route, which wins by later registration.
        if (host === 'raw.githubusercontent.com' &&
            /(?:\/notam-data\/|\/notam\.json)$/.test(new URL(url).pathname)) {
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

    // 2b. Page-level: make map.setView() land instantly under test. Specs read
    //     screen coordinates (proj(), latLngToContainerPoint(), getCenter())
    //     immediately after positioning the map, and a SAME-ZOOM setView is an
    //     animated pan in Leaflet — so those reads raced a slide still in
    //     progress. It only surfaced when the app's landing zoom happened to
    //     equal the zoom a spec asked for, which makes it a latent flake in ~48
    //     call sites across 25 specs rather than a bug in any one of them.
    //     (Zoom animation is already off in the app, to keep the canvas overlay
    //     in sync; this extends the same determinism to pans.)
    await page.addInitScript(() => {
      const install = () => {
        if (typeof window.L === 'undefined' || !window.L.Map) return false;
        const orig = window.L.Map.prototype.setView;
        window.L.Map.prototype.setView = function (center, zoom, options) {
          return orig.call(this, center, zoom, Object.assign({}, options, { animate: false }));
        };
        return true;
      };
      if (!install()) {
        const iv = setInterval(() => { if (install()) clearInterval(iv); }, 2);
        window.addEventListener('load', () => clearInterval(iv));
      }
    });

    await use(page);

    // 3. After the test, verify deployed SHA if EXPECTED_SHA is set.
    //    Catches cases where page.goto resolved to a different deployment
    //    than the one being tested (e.g. production root instead of /pr/NNN/).
    if (EXPECTED_SHA) {
      try {
        const resp = await page.request.get('app/core.js');
        const text = await resp.text();
        const m = text.match(/version: '1\.0-([A-Za-z0-9]+)'/);
        const sha = m ? m[1] : null;
        if (sha && sha !== EXPECTED_SHA) {
          throw new Error(
            `SHA mismatch: page deployed commit ${sha}, ` +
            `expected ${EXPECTED_SHA}. Tests may be running against the wrong URL.`
          );
        }
      } catch (e) {
        // If the page was closed or navigate failed, skip verification.
        if (e.message?.includes('SHA mismatch')) throw e;
      }
    }
  },
});

exports.expect = base.expect;
