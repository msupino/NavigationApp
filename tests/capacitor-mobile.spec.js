// @ts-check
// Static checks for the Capacitor native wrapper. CI does not build signed
// iOS/Android binaries, but it should catch accidental drift in the wrapper.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'));
}

function readText(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

test.describe('Capacitor mobile wrapper', () => {
  test('is isolated from the root web/test package', () => {
    const rootPackage = readJson('package.json');
    const mobilePackage = readJson('mobile/package.json');
    const rootDeps = {
      ...rootPackage.dependencies,
      ...rootPackage.devDependencies,
    };

    expect(mobilePackage.scripts.validate).toBe('node scripts/validate-capacitor.mjs');
    expect(mobilePackage.scripts.sync).toContain('cap sync');
    for (const dep of ['@capacitor/core', '@capacitor/android', '@capacitor/ios', '@capacitor/cli']) {
      expect(rootDeps[dep], `${dep} should stay out of the root package`).toBeUndefined();
    }
  });

  test('loads the production site (self-updating shell) with a stub webDir', () => {
    const config = readJson('mobile/capacitor.config.json');

    expect(config.appId).toBe('org.supino.navaid');
    expect(config.appName).toBe('NavAid');
    // Remote-URL mode: the WebView loads production, so the installed app
    // updates with every web deploy; webDir is only the packaged stub.
    expect(config.webDir).toBe('shell');
    expect(config.server.url).toBe('https://navaid.supino.org');
    expect(config.server.androidScheme).toBe('https');
    expect(fs.existsSync(path.join(__dirname, '..', 'mobile', 'shell', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '..', 'docs', 'index.html'))).toBe(true);
  });

  test('ships the lock-screen GPS foreground service (Android)', () => {
    const manifest = readText('mobile/android/app/src/main/AndroidManifest.xml');
    const mobilePackage = readJson('mobile/package.json');

    expect(mobilePackage.dependencies['@capacitor-community/background-geolocation']).toBeTruthy();
    for (const perm of ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION',
      'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION', 'POST_NOTIFICATIONS']) {
      expect(manifest, `${perm} must be declared`).toContain(perm);
    }
    // iOS: the site's SW (offline + chart packs) only runs for app-bound domains.
    const iosInfo = readText('mobile/ios/App/App/Info.plist');
    expect(iosInfo).toContain('WKAppBoundDomains');
    expect(iosInfo).toContain('navaid.supino.org');
  });

  test('sets native package identifiers and display names', () => {
    const androidGradle = readText('mobile/android/app/build.gradle');
    const androidStrings = readText('mobile/android/app/src/main/res/values/strings.xml');
    const androidInstrumentedTest = readText(
      'mobile/android/app/src/androidTest/java/org/supino/navaid/ExampleInstrumentedTest.java');
    const iosProject = readText('mobile/ios/App/App.xcodeproj/project.pbxproj');
    const iosInfo = readText('mobile/ios/App/App/Info.plist');

    expect(androidGradle).toContain('namespace = "org.supino.navaid"');
    expect(androidGradle).toContain('applicationId "org.supino.navaid"');
    expect(androidStrings).toContain('<string name="app_name">NavAid</string>');
    expect(androidInstrumentedTest).toContain('package org.supino.navaid;');
    expect(androidInstrumentedTest).toContain('assertEquals("org.supino.navaid"');
    expect(iosProject).toContain('PRODUCT_BUNDLE_IDENTIFIER = org.supino.navaid;');
    expect(iosInfo).toContain('<key>CFBundleDisplayName</key>');
    expect(iosInfo).toContain('<string>NavAid</string>');
  });

  test('keeps analytics browser-only but lets the SW run in the remote shell', () => {
    const indexHtml = readText('docs/index.html');
    const uiJs = readText('docs/app/ui.js');

    // GA gated on both the legacy local origin AND the injected Capacitor
    // bridge (the remote-URL shell loads the production hostname).
    expect(indexHtml).toContain("location.hostname !== 'app.navaid.local'");
    expect(indexHtml).toContain("typeof window.Capacitor === 'undefined'");
    expect(uiJs).toContain('function isNativeCapacitorShell()');
    // The SW must register in the remote-URL shell (offline + chart packs
    // depend on it) — only the legacy local-origin shell skips it.
    expect(uiJs).toContain('function isNativeLocalOrigin()');
    expect(uiJs).toContain("'serviceWorker' in navigator && !isNativeLocalOrigin()");
  });
});
