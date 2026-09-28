// @ts-check
// The APK carries the web app inside it (npm run embed), so it starts with no network. Three
// things change when the app runs from the package instead of the site, and each is pinned
// here: links meant for someone else still name the live site, no service worker caches what
// is already on the phone, and every production deploy publishes the update bundle the
// embedded app installs on its next cold start (docs/app/ota.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect } = require('./_setup');

const repoRoot = path.join(__dirname, '..');

async function boot(page, embedded) {
  if (embedded) await page.addInitScript(() => { window.__navaidEmbedded = true; });
  await page.goto('?lang=en');
  await page.waitForFunction(() => typeof buildShareUrl === 'function' && typeof publicAppUrl === 'function');
}

test('a shared route from the embedded app opens the live site, not https://localhost', async ({ page }) => {
  await boot(page, true);
  const out = await page.evaluate(() => {
    state.waypoints = [{ lat: 32.1, lng: 34.9, name: 'A' }, { lat: 32.3, lng: 35.1, name: 'B' }];
    syncLegs();
    return { base: publicAppUrl(), share: buildShareUrl() };
  });
  expect(out.base).toBe('https://navaid.supino.org/');
  const url = typeof out.share === 'string' ? out.share : out.share.url;
  expect(url.startsWith('https://navaid.supino.org/?')).toBe(true);
});

test('the site itself still shares its own address', async ({ page }) => {
  await boot(page, false);
  const out = await page.evaluate(() => ({ base: publicAppUrl(), here: location.origin + location.pathname }));
  expect(out.base).toBe(out.here);
});

test('the embedded app registers no service worker', async ({ page }) => {
  await boot(page, true);
  expect(await page.evaluate(() => isNativeLocalOrigin())).toBe(true);
});

test('the update bundle is built from the assembled production site, and only from it', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navaid-ota-'));
  const site = path.join(tmp, 'site');
  fs.cpSync(path.join(repoRoot, 'docs', 'index.html'), path.join(site, 'index.html'));
  fs.cpSync(path.join(repoRoot, 'docs', 'app'), path.join(site, 'app'), { recursive: true });
  fs.cpSync(path.join(repoRoot, 'docs', 'i18n'), path.join(site, 'i18n'), { recursive: true });
  for (const f of ['manifest.json', 'terms.html', 'privacy.html']) {
    fs.cpSync(path.join(repoRoot, 'docs', f), path.join(site, f));
  }
  // What sits beside production in the deploy and must never ship inside the app.
  fs.mkdirSync(path.join(site, 'staging'), { recursive: true });
  fs.writeFileSync(path.join(site, 'staging', 'index.html'), 'dev');
  fs.mkdirSync(path.join(site, 'pr', '9'), { recursive: true });
  fs.writeFileSync(path.join(site, 'pr', '9', 'index.html'), 'preview');
  fs.mkdirSync(path.join(site, 'ota'), { recursive: true });
  fs.writeFileSync(path.join(site, 'ota', 'manifest.json'), '{}');
  const build = (out) => {
    execFileSync('node', [path.join(repoRoot, 'mobile/scripts/build-ota.mjs'), '--from', site,
      '--out', out, '--manifest', path.join(out, 'manifest.json'), '--version', '1.0-test',
      '--base-url', 'https://navaid.supino.org/ota'],
    { env: { ...process.env, SOURCE_DATE_EPOCH: '1790000000' }, stdio: 'pipe' });
    return JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  };
  const a = build(path.join(tmp, 'a'));
  const b = build(path.join(tmp, 'b'));
  expect(a.url).toBe('https://navaid.supino.org/ota/navaid-1.0-test.zip');
  expect(a.version).toBe('1.0-test');
  // Every deploy rebuilds it for the same commit: it must come out byte for byte the same.
  expect(b.checksum).toBe(a.checksum);
  const zip = fs.readFileSync(path.join(tmp, 'a', 'navaid-1.0-test.zip')).toString('latin1');
  expect(zip).toContain('app/core.js');
  expect(zip).not.toContain('staging/index.html');
  expect(zip).not.toContain('pr/9/index.html');
  expect(zip).not.toContain('ota/manifest.json');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('every production deploy publishes the update bundle on the site', () => {
  const deploy = fs.readFileSync(path.join(repoRoot, '.github/workflows/deploy.yml'), 'utf8');
  expect(deploy).toContain('build-ota.mjs --from site --out site/ota');
  expect(deploy).toContain('--base-url https://navaid.supino.org/ota');
  expect(deploy).toContain('SOURCE_DATE_EPOCH');
  const ota = fs.readFileSync(path.join(repoRoot, 'docs/app/ota.js'), 'utf8');
  expect(ota).toContain("'https://navaid.supino.org/ota/manifest.json'");
});

test('npm run embed prepares Android as well as iOS', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'mobile/package.json'), 'utf8'));
  expect(pkg.scripts.embed).toMatch(/cap sync$/);
  const plugins = fs.readFileSync(path.join(repoRoot, 'mobile/android/capacitor.settings.gradle'), 'utf8');
  expect(plugins).toContain('capgo-capacitor-updater');
  expect(plugins).toContain('capacitor-network');
});

test('the native app shows its package version beside the web version', async ({ page }) => {
  await page.addInitScript(() => {
    window.Capacitor = {
      isNativePlatform: () => true, getPlatform: () => 'android',
      Plugins: { App: { getInfo: async () => ({ version: '1.9', build: '9' }) } },
    };
  });
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof NavAid.showNativeAppVersion === 'function');
  await expect(page.locator('#legend-version')).toHaveText(/^v.+ · APK 1\.9$/);
  const text = await page.evaluate(() => document.getElementById('app-version').textContent);
  expect(text).toMatch(/ · APK 1\.9$/);
});

test('the web app shows only the web version', async ({ page }) => {
  await page.goto('?lang=en&nogist');
  await page.waitForFunction(() => typeof NavAid.showNativeAppVersion === 'function');
  expect(await page.evaluate(() => document.getElementById('app-version').textContent)).not.toContain('APK');
});
