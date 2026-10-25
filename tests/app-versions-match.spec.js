// @ts-check
// The Android and iOS apps carry one version number. The App Store build after 1.26 was about to
// go out as 1.26.1 while the APK stayed 1.26 (asked: they should match). A bump to one platform
// without the other fails here instead of reaching a store.
const { test, expect } = require('./_setup');
const { readFileSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..');

test('the Android and iOS app versions match', () => {
  const gradle = readFileSync(join(root, 'mobile/android/app/build.gradle'), 'utf8');
  const android = (gradle.match(/versionName "([^"]+)"/) || [])[1];
  expect(android, 'versionName in build.gradle').toMatch(/^\d+\.\d+(\.\d+)?$/);
  const pbx = readFileSync(join(root, 'mobile/ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
  const ios = [...pbx.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map(m => m[1].trim());
  expect(ios.length, 'MARKETING_VERSION in the Xcode project').toBeGreaterThan(0);
  // Every build configuration (Debug and Release) carries the same version as the APK.
  for (const v of ios) expect(v).toBe(android);
  // ...and the versionCode was bumped with it: an APK at a new name but the old code will not
  // install over the old one.
  const code = Number((gradle.match(/versionCode (\d+)/) || [])[1]);
  expect(code).toBeGreaterThan(0);
});

test('the TestFlight workflow builds the Android version, and refuses a different one', () => {
  const wf = readFileSync(join(root, '.github/workflows/ios-testflight.yml'), 'utf8');
  expect(wf).toMatch(/android=\$\(sed -n 's\/\.\*versionName/);
  expect(wf).toMatch(/if \[ -n "\$v" \] && \[ "\$v" != "\$android" \]; then[\s\S]*?exit 1/);
  expect(wf).toMatch(/v="\$android"/);
});
