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
    expect(config.ios.limitsNavigationsToAppBoundDomains).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '..', 'mobile', 'shell', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(__dirname, '..', 'docs', 'index.html'))).toBe(true);
  });

  test('ships the lock-screen GPS foreground service (Android)', () => {
    const manifest = readText('mobile/android/app/src/main/AndroidManifest.xml');
    const mobilePackage = readJson('mobile/package.json');
    const config = readJson('mobile/capacitor.config.json');
    const androidGradle = readText('mobile/android/app/build.gradle');

    expect(mobilePackage.dependencies['@capacitor-community/background-geolocation']).toBeTruthy();
    // The version moves with every APK release, so pin the SHAPE, not the number: a test that
    // has to be edited for each build is a test nobody reads.
    const code = androidGradle.match(/versionCode\s+(\d+)/);
    const name = androidGradle.match(/versionName\s+"([\d.]+)"/);
    expect(code, 'versionCode must be declared').toBeTruthy();
    expect(name, 'versionName must be declared').toBeTruthy();
    expect(Number(code[1])).toBeGreaterThanOrEqual(5);
    expect(name[1]).toMatch(/^\d+\.\d+$/);
    expect(config.ios.includePlugins).toEqual([
      '@capacitor-community/text-to-speech',
      '@capacitor/local-notifications',
      '@capgo/capacitor-social-login',
    ]);
    expect(config.ios.includePlugins).not.toContain('@capacitor-community/background-geolocation');
    for (const perm of ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION',
      'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION', 'POST_NOTIFICATIONS',
      'ACCESS_WIFI_STATE', 'CHANGE_WIFI_MULTICAST_STATE']) {
      expect(manifest, `${perm} must be declared`).toContain(perm);
    }
    expect(manifest).toContain('android:usesCleartextTraffic="true"');
    // iOS: the site's SW (offline + chart packs) only runs for app-bound domains.
    const iosInfo = readText('mobile/ios/App/App/Info.plist');
    expect(iosInfo).toContain('WKAppBoundDomains');
    expect(iosInfo).toContain('navaid.supino.org');
    expect(config.ios.limitsNavigationsToAppBoundDomains).toBe(true);
    expect(iosInfo).toMatch(/<key>NSAllowsLocalNetworking<\/key>\s*<true\/>/);
    expect(iosInfo).toMatch(/<key>NSLocalNetworkUsageDescription<\/key>\s*<string>[^<]+<\/string>/);
    expect(iosInfo).not.toContain('NSAllowsArbitraryLoads');
    expect(iosInfo).toContain('finds X-Plane');
  });

  test('declares foreground location access for iOS', () => {
    const iosInfo = readText('mobile/ios/App/App/Info.plist');
    const purpose = iosInfo.match(
      /<key>NSLocationWhenInUseUsageDescription<\/key>\s*<string>([^<]*)<\/string>/,
    );

    expect(purpose, 'iOS foreground location requires a purpose string').toBeTruthy();
    expect(purpose[1].trim(), 'the iOS location purpose string must not be empty').not.toBe('');
  });

  test('keeps the native iOS screen awake only while the app is active', () => {
    const iosDelegate = readText('mobile/ios/App/App/AppDelegate.swift');

    expect(iosDelegate).toMatch(
      /didFinishLaunchingWithOptions[^{]*\{[^}]*application\.isIdleTimerDisabled = true/,
    );
    expect(iosDelegate).toMatch(
      /applicationWillResignActive[^{]*\{[^}]*application\.isIdleTimerDisabled = false/,
    );
    expect(iosDelegate).toMatch(
      /applicationDidBecomeActive[^{]*\{[^}]*application\.isIdleTimerDisabled = true/,
    );
  });

  test('registers native X-Plane discovery without requiring an iOS multicast entitlement', () => {
    const androidPlugin = readText(
      'mobile/android/app/src/main/java/org/supino/navaid/XPlaneDiscoveryPlugin.java');
    const androidActivity = readText(
      'mobile/android/app/src/main/java/org/supino/navaid/MainActivity.java');
    const iosDelegate = readText('mobile/ios/App/App/AppDelegate.swift');
    const iosStoryboard = readText('mobile/ios/App/App/Base.lproj/Main.storyboard');

    expect(androidPlugin).toContain('@CapacitorPlugin(name = "XPlaneDiscovery")');
    expect(androidPlugin).toContain('239.255.1.1');
    expect(androidPlugin).toContain('49707');
    expect(androidPlugin).toContain("data[0] == 'B'");
    expect(androidPlugin).toContain('UNTRUSTED_ORIGIN');
    expect(androidPlugin).toContain('probeBridge(host)');
    expect(androidActivity).toContain('registerPlugin(XPlaneDiscoveryPlugin.class)');
    expect(iosDelegate).toContain('class XPlaneDiscoveryPlugin: CAPPlugin, CAPBridgedPlugin');
    expect(iosDelegate).toContain('source": "local-bridge-scan"');
    expect(iosDelegate).toContain('UNTRUSTED_ORIGIN');
    expect(iosDelegate).toContain('interface.ifa_addr');
    expect(iosDelegate).toContain('interface.ifa_netmask');
    expect(iosDelegate).toContain('LOCAL_NETWORK_DENIED');
    expect(iosDelegate).not.toContain('NWMulticastGroup');
    expect(iosStoryboard).toContain('customClass="NavAidBridgeViewController"');
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

  test('loads no analytics runtime and lets the SW run in the remote shell', () => {
    const indexHtml = readText('docs/index.html');
    const uiJs = readText('docs/app/ui.js');

    expect(indexHtml).not.toContain('googletagmanager');
    expect(uiJs).toContain('function isNativeCapacitorShell()');
    // The SW must register in the remote-URL shell (offline + chart packs
    // depend on it) — only the legacy local-origin shell skips it.
    expect(uiJs).toContain('function isNativeLocalOrigin()');
    expect(uiJs).toContain("'serviceWorker' in navigator && !isNativeLocalOrigin()");
  });
});
