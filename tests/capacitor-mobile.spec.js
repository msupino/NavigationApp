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

  test('packages the static docs app with a native-only origin', () => {
    const config = readJson('mobile/capacitor.config.json');

    expect(config.appId).toBe('org.supino.navaid');
    expect(config.appName).toBe('NavAid');
    expect(config.webDir).toBe('../docs');
    expect(config.server.hostname).toBe('app.navaid.local');
    expect(config.server.androidScheme).toBe('https');
    expect(fs.existsSync(path.join(__dirname, '..', 'docs', 'index.html'))).toBe(true);
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

  test('disables browser-only PWA/analytics behavior inside the native shell', () => {
    const indexHtml = readText('docs/index.html');
    const uiJs = readText('docs/app/ui.js');

    expect(indexHtml).toContain("location.hostname !== 'app.navaid.local'");
    expect(uiJs).toContain('function isNativeCapacitorShell()');
    expect(uiJs).toContain('!isNativeCapacitorShell()');
  });
});
