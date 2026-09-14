// @ts-check
// Packaging checks complement the native Release build and device submission checklist.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('./_setup');

const repoRoot = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('the embedded build is a real bundle, not a stub around a URL', async () => {
  const bundle = await import('../mobile/scripts/bundle-web.mjs');
  const embedded = bundle.embeddedConfig();
  expect(embedded.server.url).toBeUndefined();
  expect(embedded.webDir).toBe('www');
  // Keep bridge injection restricted for both remote and bundled pages.
  expect(embedded.ios.limitsNavigationsToAppBoundDomains).toBe(true);
  // ...and the remote shell is still exactly what it was: this is a second mode, not a
  // replacement. Android and development installs can keep self-updating.
  const remote = bundle.remoteConfig();
  expect(remote.server.url).toBe('https://navaid.supino.org');
  expect(remote.webDir).toBe('shell');
  expect(remote.ios.limitsNavigationsToAppBoundDomains).toBe(true);
  // The config in the repo is one of the two, unedited by hand.
  const current = JSON.parse(read('mobile/capacitor.config.json'));
  expect([JSON.stringify(remote), JSON.stringify(embedded)]).toContain(JSON.stringify(current));
});

// Over-the-air updates are an updater the app drives, not one that phones home. Both halves
// have to be written down in the config: unset is not off.
test('the updater neither updates on its own nor reports to anyone', async () => {
  const bundle = await import('../mobile/scripts/bundle-web.mjs');
  for (const [mode, config] of [['remote', bundle.remoteConfig()], ['embedded', bundle.embeddedConfig()]]) {
    const updater = config.plugins && config.plugins.CapacitorUpdater;
    expect(updater, mode + ' has no CapacitorUpdater config').toBeTruthy();
    // Two updaters disagreeing about which bundle is current is what strands an app on a
    // broken one. Ours is docs/app/ota.js.
    expect(updater.autoUpdate, mode).toBe(false);
    expect(updater.updateUrl, mode).toBeUndefined();
    expect(updater.channelUrl, mode).toBeUndefined();
    // statsUrl defaults to Capgo's own server, and the NATIVE lifecycle reports there --
    // a device id, app and OS version, on every backgrounding -- even with autoUpdate off.
    // The plugin skips the report only when the URL is empty.
    expect(updater.statsUrl, mode + ' sends telemetry to Capgo').toBe('');
  }
  // The rollback window docs/app/ota.js waits inside before vouching for a bundle.
  expect(bundle.embeddedConfig().plugins.CapacitorUpdater.appReadyTimeout).toBe(20000);
  // navigator.connection does not exist in WKWebView, so the connection type has to come
  // from a native plugin or the cellular check is decoration.
  expect(bundle.remoteConfig().ios.includePlugins).toContain('@capacitor/network');
});

test('the bundle carries every file the app cannot start without', async () => {
  const bundle = await import('../mobile/scripts/bundle-web.mjs');
  for (const rel of bundle.MUST_BUNDLE) {
    expect(fs.existsSync(path.join(repoRoot, 'docs', rel)), rel + ' is gone from docs/').toBe(true);
  }
  // Every script index.html loads has to be in the bundle, or the embedded app is a blank
  // page on a reviewer's phone with no network to fall back to.
  const index = read('docs/index.html');
  const srcs = [...index.matchAll(/'(app\/[\w-]+\.js)'\s*\+\s*v/g)].map((m) => m[1]);
  expect(srcs.length).toBeGreaterThan(10);
  const files = bundle.walk(path.join(repoRoot, 'docs')).map((f) => f.rel.split(path.sep).join('/'));
  for (const src of srcs) expect(files, src + ' would not be bundled').toContain(src);
  // ...and what is deliberately left behind is left behind.
  for (const dir of bundle.LEAVE_ON_THE_SERVER) {
    expect(files.filter((f) => f.startsWith(dir + '/'))).toEqual([]);
  }
});

test('the privacy manifest says what the app actually does', () => {
  const manifest = read('mobile/ios/App/App/PrivacyInfo.xcprivacy');
  expect(manifest).toContain('<key>NSPrivacyTracking</key>');
  expect(manifest).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  // Location is collected, for app functionality, not linked to an identity, not tracking.
  // These four answers have to match the App Store Connect questionnaire exactly.
  expect(manifest).toContain('NSPrivacyCollectedDataTypePreciseLocation');
  expect(manifest).toContain('NSPrivacyCollectedDataTypePurposeAppFunctionality');
  expect(manifest).toMatch(/NSPrivacyCollectedDataTypeLinked<\/key>\s*<false\/>/);
  expect(manifest).toMatch(/NSPrivacyCollectedDataTypeTracking<\/key>\s*<false\/>/);
  // Every required-reason API the app touches, with a reason code.
  for (const api of ['UserDefaults', 'FileTimestamp', 'DiskSpace', 'SystemBootTime']) {
    expect(manifest, api + ' has no declared reason').toContain('NSPrivacyAccessedAPICategory' + api);
  }
});

test('the encryption question is answered in the binary, not at every upload', () => {
  const plist = read('mobile/ios/App/App/Info.plist');
  expect(plist).toMatch(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  // Bilingual, and the store listing has to know it.
  const locales = plist.match(/<key>CFBundleLocalizations<\/key>\s*<array>([\s\S]*?)<\/array>/);
  expect(locales).not.toBeNull();
  expect(locales[1]).toContain('<string>en</string>');
  expect(locales[1]).toContain('<string>he</string>');
});

test('the screenshot tool asks for the sizes Apple checks', async () => {
  const shots = await import('../scripts/appstore-screenshots.mjs');
  // 6.9" iPhone: 1320x2868. 13" iPad: 2064x2752. Rendered at the device scale, so the PNG
  // is the pixel size, and a wrong one is rejected on upload.
  for (const [key, want] of [['iphone', '1320x2868'], ['ipad', '2064x2752']]) {
    const d = shots.DEVICES[key];
    expect(`${d.width * d.scale}x${d.height * d.scale}`, key + ' is not the required size').toBe(want);
    expect(d.pixels).toBe(want);
  }
});

test('the listing copy fits the fields it goes in', () => {
  const metadata = read('mobile/appstore/metadata.md');
  const subtitle = metadata.match(/`([^`]+)` — \d+/);
  expect(subtitle, 'no subtitle in metadata.md').not.toBeNull();
  expect(subtitle[1].length, 'subtitle over 30 characters').toBeLessThanOrEqual(30);
  const keywords = metadata.match(/`(vfr,[^`]+)`/);
  expect(keywords, 'no keyword line').not.toBeNull();
  expect(keywords[1].length, 'keywords over 100 characters').toBeLessThanOrEqual(100);
  expect(keywords[1]).not.toMatch(/,\s/);         // spaces after commas waste the budget
  // The description carries the same disclaimer the app shows. A listing that promises
  // navigation and an app that refuses to be one is the mismatch reviewers do read for.
  expect(metadata).toMatch(/not certified for navigation/i);
  // The URLs Apple requires, and both are pages this repo actually serves.
  for (const page of ['privacy.html', 'about.html', 'terms.html']) {
    expect(metadata).toContain(page);
    expect(fs.existsSync(path.join(repoRoot, 'docs', page)), 'docs/' + page + ' is missing').toBe(true);
  }
});

test('the review notes tell a reviewer how to see the app work', () => {
  const notes = read('mobile/appstore/review-notes.md');
  expect(notes).toMatch(/no sign-in|No account/i);      // no demo account to hunt for
  expect(notes).toMatch(/location/i);
  expect(notes).toMatch(/While Using the App/);         // the exact permission asked for
  expect(notes).toMatch(/not certified for navigation/i);
});

test('the privacy manifest is included in the app target resources', () => {
  const project = read('mobile/ios/App/App.xcodeproj/project.pbxproj');
  const resources = project.match(/Begin PBXResourcesBuildPhase section([\s\S]*?)End PBXResourcesBuildPhase/)[1];
  expect(resources).toContain('PrivacyInfo.xcprivacy in Resources');
});

test('the embedded bundle includes integrity-checked CDN assets', async () => {
  const bundle = await import('../mobile/scripts/bundle-web.mjs');
  expect(typeof bundle.validateVendorAssets).toBe('function');
  expect(() => bundle.validateVendorAssets()).not.toThrow();
  const html = bundle.embeddedIndex(read('docs/index.html'));
  for (const url of ['https://unpkg.com/', 'https://cdn.jsdelivr.net/']) expect(html).not.toContain(url);
  expect(html).toContain('window.__navaidEmbedded = true');
});

test('CI builds the embedded release and verifies the built app resources', () => {
  const ci = read('.github/workflows/ci.yml');
  const ios = ci.slice(ci.indexOf('  native-ios:'), ci.indexOf('  dev-history:'));
  expect(ios).toContain('run embed');
  expect(ios).toContain('-configuration Release');
  expect(ios).toContain('verify-ios-app.mjs');
});
