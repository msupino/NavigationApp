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

// A 1x1 transparent PNG, served in place of every real map tile. Nothing in the suite
// asserts on tile PIXELS -- specs check which URL a layer builds, not what comes back --
// so a stand-in costs the tests nothing.
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);
// Tile hosts the suite must never actually hit. flight-maps.com is a third party's
// server: the charts are theirs, served as a courtesy, and 2000+ tests each booting the
// map into ~24 live tiles turned every CI run into tens of thousands of requests from a
// GitHub runner -- reported by its owner as millions over three months from
// "127.0.0.1:8000 in the US", which is exactly what this suite looks like from outside.
// OpenStreetMap's tile policy says the same thing about automated bulk use, and
// navaid-tiles.supino.org is only the CORS mirror of the same charts, while
// msupino.github.io serves the app's generated layers. None of them are under test here;
// the app's own behaviour is.
const TILE_HOSTS = [
  'flight-maps.com',
  'navaid-tiles.supino.org',
  'msupino.github.io',
  'tile.openstreetmap.org',
];
function isTileHost(host) {
  return TILE_HOSTS.some(h => host === h || host.endsWith('.' + h));
}
// NAVAID_TEST_TILES=mirror serves real chart imagery from OUR OWN copy
// (navaid-tiles.supino.org, the NavigationApp-tiles repo) instead of the stand-in, for the
// runs that need a picture rather than a passing assertion -- the wiki screenshots. Never
// from flight-maps.com: whose server it is, is the whole point.
// The weather feed the altimetry correction reads (sea-level pressure + temperature).
// Answered here with STANDARD atmosphere: 1013.25 hPa, 15 degrees at sea level, so the
// temperature term is exactly zero and a test's altitude arithmetic is the geoid alone --
// deterministic, and no test run touches a public API. Specs that are about the weather
// (wind, windfield, the assistant) register their own route, which wins by registering
// later. Same courtesy as the tiles: nobody's server should carry this suite's load.
const ISA_WEATHER = JSON.stringify({
  latitude: 32, longitude: 34.9, elevation: 0,
  current: { time: '2026-01-01T00:00', pressure_msl: 1013.25, temperature_2m: 15,
    surface_pressure: 1013.25 },
});

const TILE_MODE = process.env.NAVAID_TEST_TILES || 'stub';
const MIRROR_BASE = 'https://navaid-tiles.supino.org';
const MIRROR_HOST = 'navaid-tiles.supino.org';
const OWNED_TILE_HOST = 'msupino.github.io';
const MIRROR_DIR = { cvfr: 'CVFR', nav: 'Israel-Navigation', la: 'LSA-Low-Altitude', 'il-hel': 'Israel-Helicopters' };
// https://flight-maps.com/tiles/<kind>/z/x/y.png -> the same tile in our copy.
function mirrorUrlFor(url) {
  const m = /\/tiles\/(cvfr|nav|la|il-hel)\/(\d+)\/(\d+)\/(\d+)\.png/.exec(url);
  return m ? MIRROR_BASE + '/' + MIRROR_DIR[m[1]] + '/' + m[2] + '/' + m[3] + '/' + m[4] + '.png' : null;
}

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
        // Map tiles never leave the harness -- fulfilled, not aborted: an aborted tile
        // makes Leaflet retry and log errors, so the quiet answer is a real (empty) image.
        // Specs that need tile behaviour register their own route, which wins by later
        // registration.
        if (host === 'api.open-meteo.com') {
          return route.fulfill({
            status: 200, contentType: 'application/json', body: ISA_WEATHER,
            headers: { 'x-navaid-stub-weather': '1' },
          });
        }
        if (isTileHost(host)) {
          const mirrored = TILE_MODE === 'mirror' && host !== MIRROR_HOST && mirrorUrlFor(url);
          if (mirrored) return route.continue({ url: mirrored });
          if ((host === MIRROR_HOST || host === OWNED_TILE_HOST) &&
              TILE_MODE === 'mirror') return route.continue();
          // The marker header is how a test can prove nothing left the machine.
          return route.fulfill({
            status: 200, contentType: 'image/png', body: TRANSPARENT_PNG,
            headers: { 'x-navaid-stub-tile': '1' },
          });
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
