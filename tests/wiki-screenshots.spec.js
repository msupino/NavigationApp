// @ts-check
// On-demand generator for the GitHub wiki screenshots. Not part of the regular
// suite. Run against the wiki clone's img/ dir:
//   WIKI_IMG=/path/to/NavigationApp.wiki/img \
//     npx playwright test tests/wiki-screenshots.spec.js --reporter=line
//
// Mirrors og-preview.spec.js: seed the canonical demo route, drive the real UI
// into each documented state, screenshot at the page's historical dimensions.
const { test } = require('./_setup');
const path = require('path');
const fs = require('fs');
const { LLHZ, LLHA } = require('./_airfieldArp');

const OUT = process.env.WIKI_IMG ||
  path.join(__dirname, '..', '..', 'wiki', 'img');

// On-demand only: without WIKI_IMG (set by wiki-screenshots.yml) the whole
// suite skips, so regular CI / local `npm test` runs neither burn ~a minute
// of screenshotting nor write stray JPEGs outside the repo.
test.skip(!process.env.WIKI_IMG,
  'wiki-screenshot generator — set WIKI_IMG to run');

// Same 11-waypoint LLHZ→LLHA coastal demo route as og-preview / share-route,
// so every screenshot shows one consistent flight.
const ROUTE = [
  { lat: LLHZ.lat, lng: LLHZ.lng, name: 'LLHZ' },
  { lat: 32.21861, lng: 34.88250, name: 'BAZRA' },
  { lat: 32.25722, lng: 34.89111, name: 'DEROR' },
  { lat: 32.32306, lng: 34.90389, name: 'SHARO' },
  { lat: 32.46472, lng: 34.91222, name: 'HADRA' },
  { lat: 32.59194, lng: 34.94639, name: 'FRDIS' },
  { lat: 32.71444, lng: 34.97083, name: 'BOREN' },
  { lat: 32.75389, lng: 34.93694, name: 'HOTRM' },
  { lat: 32.79611, lng: 34.94333, name: 'DAROM' },
  { lat: 32.84111, lng: 34.98111, name: 'GALIM' },
  { lat: LLHA.lat, lng: LLHA.lng, name: 'LLHA' },
];

test.describe.configure({ timeout: 60000 });   // tiles + plate loads are slow

async function boot(page, lang) {
  await page.addInitScript(() => {
    try {
      localStorage.clear(); sessionStorage.clear();
      // toolbar sections closed → clean map (each shot opens only what it needs)
      for (const s of ['build', 'view', 'display', 'charts', 'export', 'print'])
        localStorage.setItem('navaid.sec.' + s, '0');
      localStorage.setItem('navaid.layer', 'CVFR');
    } catch (e) {}
  });
  await page.goto('?lang=' + lang);
  await page.waitForFunction(() =>
    typeof state !== 'undefined' && typeof draw === 'function' && !!window.airfields);
  // The boot splash sits above everything at a high z-index; element-clipped
  // shots (e.g. the Extra-layers panel body) otherwise capture the splash,
  // not the UI. Drop it once the app is live.
  await page.evaluate(() => {
    const el = document.getElementById('boot-loading');
    if (el) el.remove();
  });
}

async function seedRoute(page) {
  await page.evaluate((route) => {
    state.waypoints = route.map(w => ({ lat: w.lat, lng: w.lng, name: w.name }));
    syncLegs();
    fitView();
    draw();
  }, ROUTE);
  await page.waitForTimeout(2500);   // tiles settle
}

function save(page, name, clip) {
  fs.mkdirSync(OUT, { recursive: true });
  return page.screenshot({
    path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 85,
    fullPage: false, ...(clip ? { clip } : {}),
  });
}

test.describe('wiki screenshots', () => {
  // ── Overview (full map + route) ──────────────────────────────────────────
  for (const [name, lang] of [['01-overview-en', 'en'], ['02-overview-he', 'he']]) {
    test(name, async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await boot(page, lang);
      await seedRoute(page);
      await save(page, name);
    });
  }

  // ── Flight Plan modal ────────────────────────────────────────────────────
  for (const [name, lang] of [['03-flight-plan', 'en'], ['03-flight-plan-he', 'he']]) {
    test(name, async ({ page }) => {
      // The plan modal (vertical profile + full leg table incl. the Freq
      // column) is wider than 1280 and gets clipped on the right; give it room.
      await page.setViewportSize({ width: 1600, height: 900 });
      await boot(page, lang);
      await seedRoute(page);
      await page.evaluate(() => showFlightPlan());
      await page.waitForTimeout(500);
      await save(page, name);
    });
  }

  // ── Floating search overlay (with results) ───────────────────────────────
  for (const [name, lang, q] of [['04-search', 'en', 'her'], ['04-search-he', 'he', 'הרצ']]) {
    test(name, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 820 });
      await boot(page, lang);
      await seedRoute(page);
      await page.evaluate(() => showSearchOverlay());
      const input = page.locator('#wp-search');
      await input.fill(q);
      await page.waitForTimeout(600);   // debounced results
      await save(page, name);
    });
  }

  // ── Airfield charts modal ────────────────────────────────────────────────
  for (const [name, lang] of [['05-charts', 'en'], ['05-charts-he', 'he']]) {
    test(name, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 820 });
      await boot(page, lang);
      await seedRoute(page);
      await page.evaluate(() => showChartsModal('LLHZ'));
      await page.waitForTimeout(600);
      await save(page, name);
    });
  }

  // ── Inspector (a leg selected) ───────────────────────────────────────────
  for (const [name, lang] of [['06-inspector', 'en'], ['06-inspector-he', 'he']]) {
    test(name, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 820 });
      await boot(page, lang);
      await seedRoute(page);
      await page.evaluate(() => {
        state.selected = { type: 'wp', index: 5 };
        showInspector();
        draw();
      });
      await page.waitForTimeout(400);
      await save(page, name);
    });
  }

  // ── Extra-layers menu (just the floating panel) ──────────────────────────
  // The "Extra layers" toolbar section is data-sec="weather"; its body floats.
  test('07-extra-layers', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await boot(page, 'en');
    await page.locator('[data-sec="weather"] .tb-section-head').click();
    const body = page.locator('[data-sec="weather"] .tb-section-body');
    await body.waitFor({ state: 'visible' });
    await page.waitForTimeout(300);
    fs.mkdirSync(OUT, { recursive: true });
    await body.screenshot({ path: path.join(OUT, '07-extra-layers.jpg'),
      type: 'jpeg', quality: 90 });
  });

  // ── Collapsed toolbar (narrow phone-width column) ────────────────────────
  for (const [name, lang] of [['07-toolbar-collapsed', 'en'], ['07-toolbar-collapsed-he', 'he']]) {
    test(name, async ({ page }) => {
      await page.setViewportSize({ width: 430, height: 820 });
      await boot(page, lang);
      await seedRoute(page);
      await save(page, name);
    });
  }

  // ── Social preview card (wiki copy) ──────────────────────────────────────
  test('og-preview', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 630 });
    await boot(page, 'en');
    await seedRoute(page);
    await save(page, 'og-preview');
  });
});
